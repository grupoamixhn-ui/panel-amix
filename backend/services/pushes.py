"""Per-stream push targets — broadcast to YouTube/Facebook/TikTok/Instagram/custom RTMP."""
from __future__ import annotations

from typing import Any

import flussonic  # late-bound _active_config / _make_client


def _push_label_from_url(url: str) -> str:
    u = (url or "").lower()
    if "youtube" in u or "ytl.live" in u:
        return "YouTube"
    if "facebook" in u or "fbcdn" in u or "live-api" in u or "rtmps://live-api" in u:
        return "Facebook"
    if "tiktok" in u or "pull-rtmp" in u and "tiktokcdn" in u:
        return "TikTok"
    if "instagram" in u or "rupload" in u:
        return "Instagram"
    if "twitch" in u:
        return "Twitch"
    if "kick.com" in u:
        return "Kick"
    return "Custom RTMP"


async def list_stream_pushes(name: str) -> list[dict[str, Any]]:
    """Return the active push targets of a stream."""
    cfg = await flussonic._active_config()  # noqa: SLF001
    async with flussonic._make_client(cfg) as c:  # noqa: SLF001
        r = await c.get(f"{cfg['api_path']}/streams/{name}")
        r.raise_for_status()
        d = r.json()
    pushes_live = d.get("pushes") or []
    pushes_disk = (d.get("config_on_disk") or {}).get("pushes") or []
    # Live `pushes` carry runtime stats; merge with disk config for the actual URL.
    by_url: dict[str, dict[str, Any]] = {}
    for p in pushes_disk:
        if isinstance(p, dict) and p.get("url"):
            by_url[p["url"]] = {
                "url": p["url"],
                "label": p.get("title") or _push_label_from_url(p["url"]),
                "active": False, "bytes": 0,
            }
    for p in pushes_live:
        if not isinstance(p, dict):
            continue
        u = p.get("url") or p.get("target") or ""
        if not u:
            continue
        entry = by_url.get(u) or {"url": u, "label": _push_label_from_url(u)}
        entry["active"] = bool(p.get("active") or p.get("alive"))
        entry["bytes"] = int(p.get("bytes") or p.get("bytes_sent") or 0)
        entry["status"] = p.get("status") or ""
        by_url[u] = entry
    return list(by_url.values())


async def add_stream_push(name: str, url: str, label: str = "") -> dict[str, Any]:
    """Append a push target to a stream (preserving existing ones)."""
    if not url:
        raise ValueError("url is required")
    cfg = await flussonic._active_config()  # noqa: SLF001
    async with flussonic._make_client(cfg) as c:  # noqa: SLF001
        r = await c.get(f"{cfg['api_path']}/streams/{name}")
        r.raise_for_status()
        d = r.json()
        on_disk = d.get("config_on_disk") or {}
        existing = list(on_disk.get("pushes") or [])
        if any((isinstance(p, dict) and p.get("url") == url) for p in existing):
            return {"ok": True, "duplicate": True}
        push_entry: dict[str, Any] = {"url": url}
        # Note: Flussonic's PUT /streams/{name} rejects `title` inside the push object
        # (returns 400 extra_keys). We only persist the label in our normalized response.
        existing.append(push_entry)
        body = {"name": name, "pushes": existing}
        r2 = await c.put(f"{cfg['api_path']}/streams/{name}", json=body)
        r2.raise_for_status()
    return {"ok": True, "pushes": await list_stream_pushes(name)}


async def remove_stream_push(name: str, url: str) -> dict[str, Any]:
    cfg = await flussonic._active_config()  # noqa: SLF001
    async with flussonic._make_client(cfg) as c:  # noqa: SLF001
        r = await c.get(f"{cfg['api_path']}/streams/{name}")
        r.raise_for_status()
        d = r.json()
        existing = list((d.get("config_on_disk") or {}).get("pushes") or [])
        kept = [p for p in existing if not (isinstance(p, dict) and p.get("url") == url)]
        if len(kept) == len(existing):
            return {"ok": True, "not_found": True}
        body = {"name": name, "pushes": kept}
        r2 = await c.put(f"{cfg['api_path']}/streams/{name}", json=body)
        r2.raise_for_status()
    return {"ok": True, "pushes": await list_stream_pushes(name)}
