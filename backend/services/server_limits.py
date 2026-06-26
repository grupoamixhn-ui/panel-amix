"""Flussonic server-wide limits (max_sessions, cache, client_timeout)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import flussonic  # late-bound for _active_config / _make_client / _DB


async def get_server_limits() -> dict[str, Any]:
    """Return server-wide limits + the cache directive (cache is stored in our DB
    because Flussonic's /config API rejects unknown keys; we expose it back as a
    flussonic.conf snippet the operator pastes on the streaming server)."""
    cfg = await flussonic._active_config()  # noqa: SLF001
    cache_path = ""
    cache_size = ""
    client_timeout = 60
    if flussonic._DB is not None:  # noqa: SLF001
        doc = await flussonic._DB.config.find_one({"_id": "server_limits"}) or {}  # noqa: SLF001
        cache_path = doc.get("cache_path") or "/storage/flussonic/cache"
        cache_size = doc.get("cache_size") or "1500G"
        client_timeout = int(doc.get("client_timeout") or 60)
    if not cfg["url"]:
        return {
            "max_sessions": 0, "client_timeout": client_timeout, "client_timeout_editable": False,
            "cache_path": cache_path, "cache_size": cache_size,
            "warning": "Flussonic not configured",
        }
    flussonic_max_sessions = 0
    async with flussonic._make_client(cfg) as c:  # noqa: SLF001
        try:
            r = await c.get(f"{cfg['api_path']}/config")
            data = r.json() if r.status_code == 200 else {}
            flussonic_max_sessions = int(data.get("max_sessions") or 0)
        except Exception:  # noqa: BLE001
            data = {}
        # Auto-init: if Flussonic has no max_sessions configured, push the default 400
        if flussonic_max_sessions == 0:
            try:
                await c.put(f"{cfg['api_path']}/config", json={"max_sessions": 400})
                flussonic_max_sessions = 400
            except Exception:  # noqa: BLE001
                pass
    return {
        "max_sessions": flussonic_max_sessions,
        "client_timeout": client_timeout,
        "client_timeout_editable": False,
        "cache_path": cache_path,
        "cache_size": cache_size,
    }


async def set_server_limits(
    *, max_sessions: int | None = None,
    cache_path: str | None = None,
    cache_size: str | None = None,
    client_timeout: int | None = None,
) -> dict[str, Any]:
    """Push max_sessions to Flussonic, persist cache + client_timeout in our DB."""
    cfg = await flussonic._active_config()  # noqa: SLF001
    if not cfg["url"]:
        raise RuntimeError("Flussonic not configured")

    # Persist locally — Flussonic API rejects cache/client_timeout keys.
    if flussonic._DB is not None and (  # noqa: SLF001
        cache_path is not None or cache_size is not None or client_timeout is not None
    ):
        update: dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
        if cache_path is not None:
            update["cache_path"] = cache_path.strip()
        if cache_size is not None:
            update["cache_size"] = cache_size.strip()
        if client_timeout is not None:
            update["client_timeout"] = int(client_timeout)
        await flussonic._DB.config.update_one(  # noqa: SLF001
            {"_id": "server_limits"}, {"$set": update}, upsert=True,
        )

    body: dict[str, Any] = {}
    if max_sessions is not None:
        body["max_sessions"] = int(max_sessions)
    if body:
        async with flussonic._make_client(cfg) as c:  # noqa: SLF001
            r = await c.put(f"{cfg['api_path']}/config", json=body)
            r.raise_for_status()
    return await get_server_limits()
