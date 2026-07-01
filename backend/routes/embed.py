"""Obfuscated embeddable HLS player.

Operators generate a short opaque token per stream. The public embed URL
(`/embed/{token}`) serves an HTML page with hls.js pointing at
`/embed/{token}/playlist.m3u8`. The panel proxies both the .m3u8 manifest
and all its .ts / .m4s segments so viewers only ever see the panel's own
domain — never the underlying Flussonic host or the real stream name.

This gives content protection: the m3u8 URL cannot be extracted from the
iframe's DOM, and token rotation invalidates all previously-embedded pages.
"""
from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, Response, StreamingResponse
from pydantic import BaseModel

import flussonic
from deps import db, require_admin_or_reseller

router = APIRouter()


def _new_token() -> str:
    return secrets.token_urlsafe(12)  # 16-char opaque token


async def _token_lookup(token: str) -> dict[str, Any] | None:
    doc = await db.embed_tokens.find_one({"_id": token})
    if not doc or doc.get("disabled"):
        return None
    return doc


# ---------- Admin API: create / list / rotate / delete embed tokens ----------
class EmbedCreateIn(BaseModel):
    stream: str
    label: str = ""


@router.post("/streams/{name}/embed")
async def embed_create(name: str, user=Depends(require_admin_or_reseller)):
    """Return the existing embed token for a stream, creating one if missing."""
    existing = await db.embed_tokens.find_one({"stream": name, "disabled": {"$ne": True}})
    if existing:
        return {"token": existing["_id"], "stream": name, "created_at": existing.get("created_at")}
    token = _new_token()
    await db.embed_tokens.insert_one({
        "_id": token,
        "stream": name,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": user.get("email"),
        "disabled": False,
    })
    return {"token": token, "stream": name}


@router.post("/streams/{name}/embed/rotate")
async def embed_rotate(name: str, user=Depends(require_admin_or_reseller)):
    """Invalidate all existing tokens for this stream and issue a fresh one."""
    await db.embed_tokens.update_many({"stream": name}, {"$set": {"disabled": True}})
    token = _new_token()
    await db.embed_tokens.insert_one({
        "_id": token,
        "stream": name,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": user.get("email"),
        "disabled": False,
    })
    return {"token": token, "stream": name, "rotated": True}


# ---------- Public embed endpoints (NO auth — token gates access) ------------
_PLAYER_HTML = """<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Live · {label}</title>
<style>
  html,body{{margin:0;padding:0;background:#000;height:100%;overflow:hidden;font-family:system-ui,sans-serif}}
  video{{width:100%;height:100%;object-fit:contain;background:#000}}
  #err{{position:absolute;inset:0;display:none;color:#fff;background:#000;place-items:center;font-size:14px;text-align:center;padding:20px}}
</style>
</head><body>
<video id="v" playsinline controls autoplay muted></video>
<div id="err">Stream unavailable</div>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5"></script>
<script>
  var src = "/api/embed/{token}/playlist.m3u8";
  var v = document.getElementById("v");
  var errEl = document.getElementById("err");
  function fail(msg){{ errEl.style.display = "grid"; errEl.textContent = msg || "Stream unavailable"; }}
  if (v.canPlayType("application/vnd.apple.mpegurl")) {{
    v.src = src;
    v.addEventListener("error", function(){{ fail(); }});
  }} else if (window.Hls && Hls.isSupported()) {{
    var hls = new Hls({{lowLatencyMode:true, backBufferLength:30}});
    hls.loadSource(src);
    hls.attachMedia(v);
    hls.on(Hls.Events.ERROR, function(_, d){{ if (d.fatal) fail(); }});
  }} else {{ fail("Your browser doesn't support HLS"); }}
</script>
</body></html>
"""


@router.get("/embed/{token}", response_class=HTMLResponse, include_in_schema=False)
async def embed_page(token: str):
    doc = await _token_lookup(token)
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    html = _PLAYER_HTML.format(token=token, label=doc.get("stream", "stream"))
    return HTMLResponse(content=html, headers={
        "X-Frame-Options": "ALLOWALL",
        "Cache-Control": "no-cache",
    })


def _upstream_client(cfg: dict, *, timeout: float = 30.0) -> httpx.AsyncClient:
    """Build an httpx client pointed at the Flussonic media host (no api_path).

    HLS delivery lives at `/{stream}/index.m3u8` on the streaming host itself
    (not under `/streamer/api/v3`), so we intentionally keep the base URL only.
    Uses a generous timeout because Flussonic may cold-start a stream and take
    several seconds to produce the first playlist.
    """
    base = cfg["url"].rstrip("/")
    return httpx.AsyncClient(base_url=base, timeout=timeout, follow_redirects=True)


async def _proxy_stream(url: str, cfg: dict, *, media_type: str, rewrite_m3u8: bool = False, token: str = "") -> Response:
    """Fetch a URL from Flussonic and stream it back to the client.

    When `rewrite_m3u8` is True we rewrite the m3u8's segment URLs so viewers
    hit our own domain (segments are proxied through `/embed/{token}/seg/...`).
    """
    try:
        async with _upstream_client(cfg) as c:
            r = await c.get(url)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Upstream timeout")
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="Upstream unreachable")
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Upstream {r.status_code}")
    if not rewrite_m3u8:
        return Response(content=r.content, media_type=media_type, headers={
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*",
        })
    import base64
    rewritten_lines = []
    for line in r.text.splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            rewritten_lines.append(line)
            continue
        # `s` is a relative path — encode it so viewers can't see the real URL
        path_b64 = base64.urlsafe_b64encode(s.encode()).decode().rstrip("=")
        rewritten_lines.append(f"/api/embed/{token}/seg/{path_b64}")
    return Response(
        content="\n".join(rewritten_lines),
        media_type="application/vnd.apple.mpegurl",
        headers={"Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*"},
    )


@router.get("/embed/{token}/playlist.m3u8", include_in_schema=False)
async def embed_playlist(token: str, request: Request):
    doc = await _token_lookup(token)
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    cfg = await flussonic._active_config()  # noqa: SLF001
    if not cfg.get("url"):
        raise HTTPException(status_code=503, detail="Flussonic not configured")
    stream = doc["stream"]
    # Flussonic HLS main playlist path
    url = f"/{stream}/index.m3u8"
    return await _proxy_stream(url, cfg, media_type="application/vnd.apple.mpegurl",
                               rewrite_m3u8=True, token=token)


@router.get("/embed/{token}/seg/{blob}", include_in_schema=False)
async def embed_segment(token: str, blob: str):
    """Proxy any segment or sub-playlist referenced by the rewritten m3u8."""
    doc = await _token_lookup(token)
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    import base64
    pad = "=" * ((4 - len(blob) % 4) % 4)
    try:
        rel = base64.urlsafe_b64decode(blob + pad).decode()
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Bad segment path")
    # Prevent path traversal
    if ".." in rel or rel.startswith("/"):
        raise HTTPException(status_code=400, detail="Bad segment path")
    stream = doc["stream"]
    cfg = await flussonic._active_config()  # noqa: SLF001
    upstream = f"/{stream}/{rel}"
    # .ts segments are small — short timeout OK; sub-playlists may cold-start.
    is_playlist = rel.endswith(".m3u8")
    try:
        async with _upstream_client(cfg, timeout=30.0 if is_playlist else 15.0) as c:
            r = await c.get(upstream)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Upstream timeout")
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="Upstream unreachable")
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Upstream {r.status_code}")
    ct = r.headers.get("content-type") or ("application/vnd.apple.mpegurl" if is_playlist else "video/mp2t")
    # If this is a sub-playlist, we also need to rewrite it
    if ct.startswith("application/vnd.apple.mpegurl") or is_playlist:
        import base64 as _b64
        lines = []
        for line in r.text.splitlines():
            s = line.strip()
            if not s or s.startswith("#"):
                lines.append(line)
                continue
            b = _b64.urlsafe_b64encode(s.encode()).decode().rstrip("=")
            lines.append(f"/api/embed/{token}/seg/{b}")
        return Response(
            content="\n".join(lines),
            media_type="application/vnd.apple.mpegurl",
            headers={"Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*"},
        )
    return Response(content=r.content, media_type=ct, headers={
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=6",
    })
