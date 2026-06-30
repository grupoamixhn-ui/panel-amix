"""Stream CRUD + push targets + outputs + live-stats endpoints."""
from __future__ import annotations

from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException

import flussonic
from deps import get_current_user
from models import StreamIn, StreamPushIn, StreamUpdateIn, ToggleIn
from scope import effective_streams

router = APIRouter()


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
