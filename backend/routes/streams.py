"""Stream CRUD + push targets + outputs + live-stats endpoints."""
from __future__ import annotations

import asyncio
import time
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import flussonic
from deps import get_current_user
from models import StreamIn, StreamPushIn, StreamUpdateIn, ToggleIn
from scope import effective_streams

router = APIRouter()


# ---------- Test-source (reachability probe) ----------
class TestSourceIn(BaseModel):
    url: str


_DEFAULT_PORT_BY_SCHEME = {"http": 80, "https": 443, "rtmp": 1935, "rtmps": 443, "rtsp": 554, "srt": 9999}


async def _tcp_probe(host: str, port: int, timeout: float = 4.0) -> None:
    """Open a TCP connection to host:port. Raises on failure."""
    _, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout=timeout)
    writer.close()
    try:
        await writer.wait_closed()
    except Exception:  # noqa: BLE001
        pass


@router.post("/streams/test-source")
async def test_source(body: TestSourceIn, _=Depends(get_current_user)):
    """Best-effort reachability check for a source URL — used by the Stream wizard."""
    url = (body.url or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")
    if url.startswith(("publish://", "file://")):
        return {"ok": True, "message": "Not testable — Flussonic will handle it locally.", "latency_ms": 0}
    try:
        parsed = urlparse(url)
    except Exception:  # noqa: BLE001
        return {"ok": False, "message": "Invalid URL", "latency_ms": 0}
    scheme = (parsed.scheme or "").lower()
    host = parsed.hostname or ""
    if not host:
        return {"ok": False, "message": "URL is missing a host", "latency_ms": 0}
    port = parsed.port or _DEFAULT_PORT_BY_SCHEME.get(scheme)
    if not port and scheme not in ("http", "https"):
        return {"ok": False, "message": f"Unknown default port for scheme {scheme!r}", "latency_ms": 0}
    started = time.monotonic()
    try:
        if scheme in ("http", "https"):
            async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as c:
                r = await c.get(url)
                latency_ms = int((time.monotonic() - started) * 1000)
                if r.status_code >= 400:
                    return {"ok": False, "message": f"HTTP {r.status_code}", "latency_ms": latency_ms}
                return {"ok": True, "message": f"HTTP {r.status_code} · {latency_ms} ms", "latency_ms": latency_ms}
        if scheme == "udp":
            return {"ok": True, "message": "UDP is connectionless — cannot verify from panel.", "latency_ms": 0}
        # rtmp/rtmps/rtsp/srt — TCP socket probe (SRT usually UDP but Flussonic's SRT LISTEN opens TCP handshake first; if fails we still say maybe)
        if scheme == "srt":
            # SRT is UDP; TCP probe is unreliable. Report a hint rather than fail.
            return {"ok": True, "message": "SRT uses UDP — reachability cannot be verified from the panel.", "latency_ms": 0}
        await _tcp_probe(host, int(port))
        latency_ms = int((time.monotonic() - started) * 1000)
        return {"ok": True, "message": f"TCP {host}:{port} reachable · {latency_ms} ms", "latency_ms": latency_ms}
    except asyncio.TimeoutError:
        return {"ok": False, "message": f"Timeout connecting to {host}:{port}", "latency_ms": 5000}
    except OSError as e:
        return {"ok": False, "message": f"Cannot reach {host}:{port} — {e.__class__.__name__}", "latency_ms": 0}
    except httpx.RequestError as e:
        return {"ok": False, "message": f"Request failed: {e.__class__.__name__}", "latency_ms": 0}


# ---------- Stream CRUD ----------
@router.get("/streams")
async def streams_list(user=Depends(get_current_user)):
    streams = await flussonic.list_streams()
    pool = await effective_streams(user)
    if pool is None:
        return streams
    pool_set = set(pool)
    return [s for s in streams if s.get("name") in pool_set]


@router.post("/streams")
async def streams_create(body: StreamIn, user=Depends(get_current_user)):
    try:
        return await flussonic.create_stream(
            body.name, body.url, body.title, body.publish_password,
            max_bitrate_kbps=body.max_bitrate_kbps,
            source_timeout=body.source_timeout,
            max_sessions=body.max_sessions,
            srt_publish_port=body.srt_publish_port,
            srt_publish_passphrase=body.srt_publish_passphrase,
            srt_play_port=body.srt_play_port,
            srt_play_passphrase=body.srt_play_passphrase,
            client_timeout=body.client_timeout,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except httpx.HTTPStatusError as e:
        # Surface Flussonic's actual rejection message (usually an "extra_keys" or
        # "validation" error) so the user can see which field failed.
        detail = e.response.text[:300] if e.response.text else f"HTTP {e.response.status_code}"
        raise HTTPException(status_code=400, detail=f"Flussonic rejected the request: {detail}")


@router.get("/streams/{name}")
async def streams_get(name: str, user=Depends(get_current_user)):
    pool = await effective_streams(user)
    if pool is not None and name not in pool:
        raise HTTPException(status_code=403, detail="Forbidden")
    s = await flussonic.get_stream(name)
    if not s:
        raise HTTPException(status_code=404, detail="Stream not found")
    return s


@router.get("/streams/{name}/raw")
async def streams_get_raw(name: str, user=Depends(get_current_user)):
    """Admin-only debug — returns the unmodified Flussonic payload."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    cfg = await flussonic._active_config()  # noqa: SLF001
    async with flussonic._make_client(cfg) as c:  # noqa: SLF001
        for path in (f"/streamer/api/v3/streams/{name}", f"/flussonic/api/v3/streams/{name}"):
            try:
                r = await c.get(path)
                if r.status_code == 200:
                    return {"path": path, "data": r.json()}
            except Exception:  # noqa: BLE001
                continue
    raise HTTPException(status_code=502, detail="Flussonic did not return raw stream data")


@router.put("/streams/{name}")
async def streams_update(name: str, body: StreamUpdateIn, user=Depends(get_current_user)):
    s = await flussonic.update_stream(name, body.model_dump(exclude_none=True))
    if not s:
        raise HTTPException(status_code=404, detail="Stream not found")
    return s


@router.delete("/streams/{name}")
async def streams_delete(name: str, user=Depends(get_current_user)):
    ok = await flussonic.delete_stream(name)
    if not ok:
        raise HTTPException(status_code=404, detail="Stream not found")
    return {"ok": True}


@router.post("/streams/{name}/toggle")
async def streams_toggle(name: str, body: ToggleIn, user=Depends(get_current_user)):
    s = await flussonic.toggle_stream(name, body.start)
    if not s:
        raise HTTPException(status_code=404, detail="Stream not found")
    return s


@router.post("/streams/{name}/reset")
async def streams_reset(name: str, user=Depends(get_current_user)):
    pool = await effective_streams(user)
    if pool is not None and name not in pool:
        raise HTTPException(status_code=403, detail="Forbidden")
    s = await flussonic.reset_stream(name)
    if not s:
        raise HTTPException(status_code=404, detail="Stream not found")
    return s


@router.get("/streams/{name}/outputs")
async def streams_outputs(name: str, user=Depends(get_current_user)):
    return await flussonic.stream_outputs(name)


@router.get("/streams/{name}/live-stats")
async def streams_live_stats(name: str, user=Depends(get_current_user)):
    pool = await effective_streams(user)
    if pool is not None and name not in pool:
        raise HTTPException(status_code=403, detail="Forbidden")
    data = await flussonic.get_stream_live_stats(name)
    if not data:
        raise HTTPException(status_code=404, detail="Stream not found")
    return data


# ---------- Push targets ----------
@router.get("/pushes")
async def all_pushes_list(user=Depends(get_current_user)):
    """List push targets across every stream the caller can access."""
    pool = await effective_streams(user)
    streams = await flussonic.list_streams()
    if pool is not None:
        pool_set = set(pool)
        streams = [s for s in streams if s.get("name") in pool_set]
    out: list[dict[str, Any]] = []
    for s in streams:
        name = s.get("name")
        if not name:
            continue
        try:
            entries = await flussonic.list_stream_pushes(name)
        except Exception:  # noqa: BLE001
            entries = []
        for p in entries or []:
            out.append({
                "stream": name,
                "stream_title": s.get("title", ""),
                "stream_alive": bool(s.get("alive")),
                **p,
            })
    return out


@router.get("/streams/{name}/pushes")
async def stream_pushes_list(name: str, user=Depends(get_current_user)):
    pool = await effective_streams(user)
    if pool is not None and name not in pool:
        raise HTTPException(status_code=403, detail="Forbidden")
    try:
        return await flussonic.list_stream_pushes(name)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Flussonic returned {e.response.status_code}")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/streams/{name}/pushes")
async def stream_push_add(name: str, body: StreamPushIn, user=Depends(get_current_user)):
    pool = await effective_streams(user)
    if pool is not None and name not in pool:
        raise HTTPException(status_code=403, detail="Forbidden")
    if not body.url:
        raise HTTPException(status_code=400, detail="url is required")
    try:
        return await flussonic.add_stream_push(name, body.url, body.label)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Flussonic rejected the push ({e.response.status_code})")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/streams/{name}/pushes")
async def stream_push_remove(name: str, url: str, user=Depends(get_current_user)):
    pool = await effective_streams(user)
    if pool is not None and name not in pool:
        raise HTTPException(status_code=403, detail="Forbidden")
    if not url:
        raise HTTPException(status_code=400, detail="url query param is required")
    try:
        return await flussonic.remove_stream_push(name, url)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Flussonic rejected the request ({e.response.status_code})")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e))
