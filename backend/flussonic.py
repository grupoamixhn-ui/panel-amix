"""Flussonic Media Server API client.

Configuration precedence (looked up on every call):
1. MongoDB `config` collection, document `_id == "flussonic"` (managed via the
   UI in Settings).
2. Env vars `FLUSSONIC_URL`, `FLUSSONIC_USER`, `FLUSSONIC_PASS`, `DEMO_MODE`.

When demo mode is on (or no FLUSSONIC_URL is configured) the client returns
realistic mock data so the admin panel works out of the box.

Real mode wraps Flussonic's HTTP Admin API (v3):
  GET    /streamer/api/v3/server
  GET    /streamer/api/v3/streams
  PUT    /streamer/api/v3/streams/{name}
  DELETE /streamer/api/v3/streams/{name}
  POST   /streamer/api/v3/streams/{name}/restart  (or /stop)
  GET    /streamer/api/v3/sessions
"""
from __future__ import annotations

import os
import asyncio
import secrets
import time
from datetime import datetime, timezone, timedelta
from typing import Any

import httpx

_rng = secrets.SystemRandom()
random = _rng  # alias

_DB = None  # set by server.py at startup


def set_db(db) -> None:
    global _DB
    _DB = db


# ---------- Config lookup ----------
async def _active_config() -> dict[str, Any]:
    cfg: dict[str, Any] = {}
    if _DB is not None:
        doc = await _DB.config.find_one({"_id": "flussonic"})
        if doc:
            cfg = doc
    return {
        "url": (cfg.get("url") or os.environ.get("FLUSSONIC_URL", "")).strip(),
        "user": cfg.get("user", os.environ.get("FLUSSONIC_USER", "")),
        "password": cfg.get("password", os.environ.get("FLUSSONIC_PASS", "")),
        "api_path": (cfg.get("api_path") or os.environ.get("FLUSSONIC_API_PATH") or "/streamer/api/v3").rstrip("/"),
        "public_host": (cfg.get("public_host") or "").strip(),
        "srt_port": int(cfg.get("srt_port") or 9998),
        "rtmp_port": int(cfg.get("rtmp_port") or 1935),
        "https": bool(cfg.get("https", True)),
    }


async def get_public_config() -> dict[str, Any]:
    """Return config safe to expose to the UI (no password)."""
    c = await _active_config()
    return {
        "url": c["url"],
        "user": c["user"],
        "has_password": bool(c["password"]),
        "api_path": c["api_path"],
        "public_host": c["public_host"],
        "srt_port": c["srt_port"],
        "rtmp_port": c["rtmp_port"],
        "https": c["https"],
    }


async def save_config(
    *, url: str, user: str, password: str | None,
    api_path: str | None = None, public_host: str | None = None,
    srt_port: int | None = None, rtmp_port: int | None = None,
    https: bool | None = None,
) -> None:
    if _DB is None:
        raise RuntimeError("DB not initialized")
    update: dict[str, Any] = {
        "url": (url or "").strip(),
        "user": user or "",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if api_path is not None:
        update["api_path"] = ("/" + api_path.strip().strip("/")) if api_path else "/streamer/api/v3"
    if public_host is not None:
        update["public_host"] = public_host.strip()
    if srt_port is not None:
        update["srt_port"] = int(srt_port)
    if rtmp_port is not None:
        update["rtmp_port"] = int(rtmp_port)
    if https is not None:
        update["https"] = bool(https)
    if password is not None:
        update["password"] = password
    await _DB.config.update_one(
        {"_id": "flussonic"},
        {"$set": update, "$setOnInsert": {"created_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )


async def clear_config() -> None:
    if _DB is None:
        raise RuntimeError("DB not initialized")
    await _DB.config.delete_one({"_id": "flussonic"})


def _make_client(cfg: dict[str, Any]) -> httpx.AsyncClient:
    base = cfg["url"].rstrip("/")
    auth = (cfg["user"], cfg["password"]) if cfg.get("user") else None
    return httpx.AsyncClient(base_url=base, auth=auth, timeout=10.0)


async def test_connection(*, url: str, user: str, password: str, api_path: str | None = None) -> dict[str, Any]:
    """Probe a Flussonic instance. Tries multiple known API paths if api_path not provided."""
    if not url:
        return {"ok": False, "error": "URL is required"}
    auth = (user, password) if user else None
    base = url.rstrip("/")
    candidates = (
        [api_path.rstrip("/")] if api_path
        else ["/streamer/api/v3", "/flussonic/api", "/api/v3", "/erlyvideo/api"]
    )
    tried: list[str] = []
    async with httpx.AsyncClient(base_url=base, auth=auth, timeout=8.0, follow_redirects=True) as c:
        for p in candidates:
            endpoint = f"{p}/server"
            tried.append(endpoint)
            try:
                r = await c.get(endpoint)
            except httpx.HTTPError as e:
                return {"ok": False, "error": f"{type(e).__name__}: {e}", "tried": tried}
            if r.status_code in (401, 403):
                return {"ok": False, "error": f"Auth failed ({r.status_code}) at {endpoint}", "tried": tried}
            if r.status_code == 404:
                continue  # try next candidate
            if r.status_code >= 400:
                return {"ok": False, "error": f"HTTP {r.status_code} at {endpoint}", "tried": tried}
            try:
                data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            except Exception:  # noqa: BLE001
                data = {}
            return {"ok": True, "version": data.get("version", "unknown"), "api_path": p, "tried": tried, "raw": data}
    return {
        "ok": False,
        "error": "API not found at any known path. Set a custom API base path or verify this is a Flussonic server.",
        "tried": tried,
    }


_BOOTED_AT = time.time()


def _log(level: str, message: str, stream: str | None = None) -> None:
    """No-op (logging is now done by the standard logger in server.py)."""
    return


# ---------- Real-mode helpers ----------
def _normalize_stream(name: str, data: dict[str, Any]) -> dict[str, Any]:
    """Map a Flussonic stream payload to the panel's schema."""
    inputs = data.get("inputs") or []
    if not inputs and data.get("url"):
        inputs = [{"url": data["url"]}]
    stats = data.get("stats") or data.get("running") or {}

    alive = bool(
        stats.get("alive")
        if "alive" in stats else data.get("alive")
        if "alive" in data else stats.get("running", False)
    )
    status = stats.get("status") or data.get("status") or ("running" if alive else "stopped")

    # Flussonic v3 publishes stats under various keys depending on version
    clients = (
        stats.get("online_clients")
        or stats.get("client_count")
        or stats.get("clients")
        or data.get("clients")
        or 0
    )
    bitrate = (
        stats.get("output_bandwidth")
        or stats.get("out_bandwidth")
        or stats.get("inputs_bandwidth")
        or stats.get("bitrate")
        or data.get("bitrate")
        or 0
    )
    # uptime in seconds — Flussonic sends `opened_at` as ms epoch and `lifetime` as ms
    uptime = 0
    if alive:
        if isinstance(stats.get("lifetime"), (int, float)):
            uptime = int(stats["lifetime"] / 1000)
        elif isinstance(stats.get("opened_at"), (int, float)):
            import time as _t
            uptime = max(0, int(_t.time() - stats["opened_at"] / 1000))
        else:
            uptime = int(stats.get("uptime") or data.get("uptime") or 0)
    # Flussonic max_bitrate is in bits/second; expose as kbit/s to the UI
    raw_max_bitrate = data.get("max_bitrate") or 0
    try:
        max_bitrate_kbps = int(raw_max_bitrate) // 1000 if raw_max_bitrate else 0
    except (TypeError, ValueError):
        max_bitrate_kbps = 0
    return {
        "name": name,
        "title": data.get("title") or data.get("name") or name,
        "inputs": inputs,
        "status": status,
        "alive": alive,
        "bitrate": int(bitrate),
        "clients": int(clients),
        "uptime": int(uptime),
        "created_at": data.get("created_at") or "",
        "publish_password": data.get("password") or data.get("publish_password") or "",
        "max_bitrate_kbps": max_bitrate_kbps,
        "source_timeout": int(data.get("source_timeout") or 0),
    }


# ---------- Public API ----------
async def get_server_info() -> dict[str, Any]:
    cfg = await _active_config()
    async with _make_client(cfg) as c:
        # /server is the only call here that can return early — fall through if it fails so the
        # dashboard still shows aggregates computed from /streams.
        server_data: dict[str, Any] = {}
        try:
            r = await c.get(f"{cfg['api_path']}/server")
            if r.status_code < 400:
                try:
                    server_data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
                except Exception:  # noqa: BLE001
                    server_data = {}
        except httpx.HTTPError:
            server_data = {}

        try:
            s2 = await c.get(f"{cfg['api_path']}/streams")
            streams_raw = s2.json() if s2.status_code == 200 else []
            if isinstance(streams_raw, dict):
                streams_raw = streams_raw.get("streams", [])
        except httpx.HTTPError:
            streams_raw = []
        normalized = [_normalize_stream(s.get("name") or "?", s) for s in streams_raw]
        live = sum(1 for s in normalized if s["alive"])
        clients = sum(s["clients"] for s in normalized)
        bw = sum(s["bitrate"] for s in normalized)
        return {
            "mode": "live",
            "version": server_data.get("version", "live"),
            "uptime": int(server_data.get("uptime", 0)),
            "streams_total": len(normalized),
            "streams_live": live,
            "clients": clients,
            "bandwidth_bps": bw,
            "cpu": server_data.get("cpu", 0),
            "memory": server_data.get("memory", 0),
        }


async def list_streams() -> list[dict[str, Any]]:
    cfg = await _active_config()
    async with _make_client(cfg) as c:
        r = await c.get(f"{cfg['api_path']}/streams")
        r.raise_for_status()
        data = r.json()
        if isinstance(data, dict):
            data = data.get("streams", [])
        return [_normalize_stream(s.get("name") or s.get("entry") or "?", s) for s in data]


async def get_stream(name: str) -> dict[str, Any] | None:
    cfg = await _active_config()
    async with _make_client(cfg) as c:
        r = await c.get(f"{cfg['api_path']}/streams/{name}")
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return _normalize_stream(name, r.json())


async def create_stream(
    name: str, url: str, title: str = "", publish_password: str | None = None,
    *, max_bitrate_kbps: int | None = None, source_timeout: int | None = None,
) -> dict[str, Any]:
    cfg = await _active_config()
    async with _make_client(cfg) as c:
        body: dict[str, Any] = {"name": name, "inputs": [{"url": url}], "title": title}
        if publish_password:
            body["password"] = publish_password
        # Flussonic max_bitrate is in bits/sec, our API takes kbit/s
        if max_bitrate_kbps is not None:
            body["max_bitrate"] = int(max_bitrate_kbps) * 1000 if max_bitrate_kbps > 0 else 0
        if source_timeout is not None:
            body["source_timeout"] = int(source_timeout)
        r = await c.put(f"{cfg['api_path']}/streams/{name}", json=body)
        r.raise_for_status()
        return _normalize_stream(name, r.json() if r.content else body)


async def update_stream(name: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    cfg = await _active_config()
    async with _make_client(cfg) as c:
        # Flussonic v3 PUT replaces the full stream config. Fetch current, merge, re-PUT.
        g = await c.get(f"{cfg['api_path']}/streams/{name}")
        if g.status_code >= 400:
            return None
        current = g.json() or {}
        # Build merged body from the on-disk config (avoids sending runtime stats back)
        merged = dict(current.get("config_on_disk") or {})
        merged.setdefault("name", name)
        # Apply incoming changes
        if "url" in payload and payload["url"]:
            merged["inputs"] = [{"url": payload["url"]}]
        if "title" in payload:
            merged["title"] = payload["title"]
        if "publish_password" in payload:
            # Flussonic only clears the password when an explicit empty string is sent.
            merged["password"] = payload["publish_password"] or ""
        if "max_bitrate_kbps" in payload:
            kbps = payload["max_bitrate_kbps"]
            merged["max_bitrate"] = (int(kbps) * 1000) if kbps and int(kbps) > 0 else 0
        if "source_timeout" in payload:
            merged["source_timeout"] = int(payload["source_timeout"] or 0)
        r = await c.put(f"{cfg['api_path']}/streams/{name}", json=merged)
        r.raise_for_status()
        try:
            return _normalize_stream(name, r.json() if r.content else merged)
        except Exception:  # noqa: BLE001
            return _normalize_stream(name, merged)


async def delete_stream(name: str) -> bool:
    cfg = await _active_config()
    async with _make_client(cfg) as c:
        r = await c.delete(f"{cfg['api_path']}/streams/{name}")
        return r.status_code in (200, 204)


async def toggle_stream(name: str, start: bool) -> dict[str, Any] | None:
    cfg = await _active_config()
    async with _make_client(cfg) as c:
        # Flussonic 24.02 exposes only GET/PUT/DELETE on the streams resource — no
        # /start /stop /restart action endpoints. Toggle by updating the `disabled`
        # flag via fetch-merge-PUT instead.
        g = await c.get(f"{cfg['api_path']}/streams/{name}")
        if g.status_code >= 400:
            return None
        merged = dict((g.json() or {}).get("config_on_disk") or {})
        merged.setdefault("name", name)
        merged["disabled"] = not start
        r = await c.put(f"{cfg['api_path']}/streams/{name}", json=merged)
        r.raise_for_status()
        g2 = await c.get(f"{cfg['api_path']}/streams/{name}")
        return _normalize_stream(name, g2.json()) if g2.status_code == 200 else None


async def reset_stream(name: str) -> dict[str, Any] | None:
    """Restart a stream by toggling ``disabled`` off→on. Kicks current viewers
    and forces Flussonic to reconnect to the source."""
    cfg = await _active_config()
    async with _make_client(cfg) as c:
        g = await c.get(f"{cfg['api_path']}/streams/{name}")
        if g.status_code >= 400:
            return None
        merged = dict((g.json() or {}).get("config_on_disk") or {})
        merged.setdefault("name", name)
        # 1) Disable to drop current ingest + viewers
        merged_off = dict(merged)
        merged_off["disabled"] = True
        r1 = await c.put(f"{cfg['api_path']}/streams/{name}", json=merged_off)
        r1.raise_for_status()
        try:
            # 2) Tiny delay so Flussonic actually tears down the input
            await asyncio.sleep(0.5)
        finally:
            # 3) Always re-enable, even if the sleep was cancelled or anything
            # weird happened — we never want to leave the stream stuck disabled.
            merged_on = dict(merged)
            merged_on["disabled"] = False
            r2 = await c.put(f"{cfg['api_path']}/streams/{name}", json=merged_on)
            r2.raise_for_status()
        g2 = await c.get(f"{cfg['api_path']}/streams/{name}")
        return _normalize_stream(name, g2.json()) if g2.status_code == 200 else None


async def list_sessions() -> list[dict[str, Any]]:
    cfg = await _active_config()
    async with _make_client(cfg) as c:
        r = await c.get(f"{cfg['api_path']}/sessions")
        r.raise_for_status()
        data = r.json()
        if isinstance(data, dict):
            data = data.get("sessions", [])
        import time as _t
        now = _t.time()
        out = []
        for s in data:
            started_ms = s.get("started_at") or s.get("opened_at")
            if isinstance(started_ms, (int, float)) and started_ms > 1e12:
                started_iso = datetime.fromtimestamp(started_ms / 1000, tz=timezone.utc).isoformat()
                duration = max(1, now - started_ms / 1000)
            else:
                started_iso = str(started_ms or "")
                duration = 1
            bytes_total = int(s.get("bytes") or s.get("bytes_out") or 0)
            bitrate = int((bytes_total * 8) / duration) if duration else 0
            out.append({
                "id": str(s.get("id") or s.get("session_id") or s.get("token") or ""),
                "stream": s.get("name") or s.get("stream") or "",
                "type": s.get("type") or "play",
                "protocol": (s.get("proto") or s.get("protocol") or "hls").lower(),
                "ip": s.get("ip") or s.get("client_ip") or "",
                "country": s.get("country") or s.get("country_code") or "",
                "user_agent": s.get("user_agent") or s.get("ua") or "",
                "bytes": bytes_total,
                "started_at": started_iso,
                "bitrate": int(s.get("bitrate") or bitrate),
            })
        return out


async def list_sessions_for_stream(name: str) -> list[dict[str, Any]]:
    all_sessions = await list_sessions()
    return [s for s in all_sessions if s.get("stream") == name]


async def get_stats_timeseries(points: int = 30) -> dict[str, Any]:
    info = await get_server_info()
    now = datetime.now(timezone.utc)
    series = [{
        "ts": (now - timedelta(minutes=i)).isoformat(),
        "clients": info.get("clients", 0),
        "bandwidth": info.get("bandwidth_bps", 0),
    } for i in range(points, 0, -1)]
    return {"series": series}


async def get_monitor_metrics() -> dict[str, Any]:
    """Single snapshot of live server metrics for the real-time Monitor page.

    Returns CPU/RAM if Flussonic ``/server`` (and optionally ``/system``) are
    reachable; otherwise ``cpu_ram_available=False`` so the UI can show a
    helpful notice and keep the bandwidth/viewer graphs working.
    """

    cfg = await _active_config()
    cpu = 0.0
    mem = 0.0
    cpu_ram_available = False
    warning = ""
    bw_out = 0
    bw_in = 0
    uptime_s = 0
    config_stats: dict[str, Any] = {}

    async with _make_client(cfg) as c:
        # Primary source: /streamer/api/v3/config — this is the endpoint that
        # most Flussonic 24.x deployments expose (including behind restrictive
        # reverse proxies). It returns a `stats` dict with cpu_usage, memory_usage,
        # input_kbit, output_kbit, total_clients, online_streams, uptime, etc.
        server_payload: dict[str, Any] = {}
        server_status: int | None = None
        try:
            r = await c.get(f"{cfg['api_path']}/config")
            server_status = r.status_code
            if r.status_code < 400 and r.headers.get("content-type", "").startswith("application/json"):
                cfg_payload = r.json() or {}
                config_stats = cfg_payload.get("stats") or {}
                if config_stats:
                    server_payload = config_stats
        except httpx.HTTPError as e:
            warning = f"Config endpoint unreachable: {type(e).__name__}"

        # Fallback chain — older API shapes / less restrictive proxies
        if not server_payload:
            for alt in ("/server", "/system", "/sys", "/server/stats"):
                try:
                    r2 = await c.get(f"{cfg['api_path']}{alt}")
                    if r2.status_code < 400 and r2.headers.get("content-type", "").startswith("application/json"):
                        server_payload = r2.json() or {}
                        break
                except httpx.HTTPError:
                    continue

        if server_payload:
            cpu_val = (
                server_payload.get("cpu_usage")
                or server_payload.get("cpu")
                or (server_payload.get("system") or {}).get("cpu")
                or 0
            )
            mem_val = (
                server_payload.get("memory_usage")
                or server_payload.get("memory")
                or (server_payload.get("system") or {}).get("memory")
                or 0
            )
            try:
                cpu = float(cpu_val)
                mem = float(mem_val)
                # Some servers return 0-1 fractions instead of 0-100
                if 0 < cpu <= 1:
                    cpu *= 100
                if 0 < mem <= 1:
                    mem *= 100
                cpu_ram_available = True
            except (TypeError, ValueError):
                cpu_ram_available = False
            # Bandwidth + uptime from the same payload
            try:
                in_kbit = float(server_payload.get("input_kbit") or 0)
                out_kbit = float(server_payload.get("output_kbit") or 0)
                bw_in = int(in_kbit * 1000)
                bw_out = int(out_kbit * 1000)
            except (TypeError, ValueError):
                bw_in = bw_out = 0
            try:
                uptime_s = int(server_payload.get("uptime") or 0)
            except (TypeError, ValueError):
                uptime_s = 0
        elif server_status == 404:
            warning = (
                "Flussonic /config endpoint blocked by your reverse proxy (404). "
                "Ask your operator to whitelist /streamer/api/v3/config to enable CPU/RAM metrics."
            )
        elif server_status in (401, 403):
            warning = f"Auth failed on /config (HTTP {server_status})."

        # Streams → bandwidth fallback + viewer roll-up
        try:
            sr = await c.get(f"{cfg['api_path']}/streams")
            streams_raw = sr.json() if sr.status_code == 200 else []
            if isinstance(streams_raw, dict):
                streams_raw = streams_raw.get("streams", [])
        except httpx.HTTPError:
            streams_raw = []

    normalized = [_normalize_stream(s.get("name") or "?", s) for s in streams_raw]
    live = sum(1 for s in normalized if s["alive"])
    # Prefer total_clients from /config (covers sessions w/o per-stream client_count).
    # Fall back to summing per-stream clients from /streams.
    clients_from_cfg = server_payload.get("total_clients") if server_payload else None
    if isinstance(clients_from_cfg, int):
        clients = clients_from_cfg
    else:
        clients = sum(s["clients"] for s in normalized)
    # If /config didn't give us bandwidth, derive from /streams
    if not bw_out:
        bw_out = sum(s["bitrate"] for s in normalized)
        bw_in = bw_out

    return {
        "ts": datetime.now(timezone.utc).isoformat(),
        "cpu": round(cpu, 1),
        "memory": round(mem, 1),
        "bandwidth_in_bps": int(bw_in),
        "bandwidth_out_bps": int(bw_out),
        "clients": int(clients),
        "streams_live": int(live),
        "streams_total": len(normalized),
        "uptime_s": int(uptime_s),
        "cpu_ram_available": cpu_ram_available,
        "source_warning": warning,
        "mode": "live",
    }


async def list_logs(limit: int = 100) -> list[dict[str, Any]]:
    return []


async def get_server_limits() -> dict[str, Any]:
    """Return server-wide limits that are editable via the Flussonic /config endpoint."""
    cfg = await _active_config()
    if not cfg["url"]:
        return {"max_sessions": 0, "client_timeout": 60, "client_timeout_editable": False, "warning": "Flussonic not configured"}
    async with _make_client(cfg) as c:
        try:
            r = await c.get(f"{cfg['api_path']}/config")
            data = r.json() if r.status_code == 200 else {}
        except Exception:  # noqa: BLE001
            data = {}
    return {
        "max_sessions": int(data.get("max_sessions") or 0),
        # client_timeout is not API-editable on Flussonic 24.x; show 60 (default) as read-only
        "client_timeout": 60,
        "client_timeout_editable": False,
    }


async def set_server_limits(*, max_sessions: int | None = None) -> dict[str, Any]:
    """Push allowed server-wide limits to Flussonic via PUT /config (root level)."""
    cfg = await _active_config()
    if not cfg["url"]:
        raise RuntimeError("Flussonic not configured")
    body: dict[str, Any] = {}
    if max_sessions is not None:
        body["max_sessions"] = int(max_sessions)
    if not body:
        return await get_server_limits()
    async with _make_client(cfg) as c:
        r = await c.put(f"{cfg['api_path']}/config", json=body)
        r.raise_for_status()
    return await get_server_limits()


async def get_branding() -> dict[str, Any]:
    if _DB is None:
        return {
            "logo_data_uri": "", "brand_name": "", "tagline": "",
            "primary_color": "", "primary_hover": "", "primary_soft": "",
        }
    doc = await _DB.config.find_one({"_id": "branding"}) or {}
    return {
        "logo_data_uri": doc.get("logo_data_uri", ""),
        "brand_name": doc.get("brand_name", ""),
        "tagline": doc.get("tagline", ""),
        "primary_color": doc.get("primary_color", ""),
        "primary_hover": doc.get("primary_hover", ""),
        "primary_soft": doc.get("primary_soft", ""),
    }


async def save_branding(
    *,
    logo_data_uri: str | None = None,
    brand_name: str | None = None,
    tagline: str | None = None,
    primary_color: str | None = None,
    primary_hover: str | None = None,
    primary_soft: str | None = None,
) -> dict[str, Any]:
    if _DB is None:
        raise RuntimeError("DB not initialized")
    update: dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if logo_data_uri is not None:
        update["logo_data_uri"] = logo_data_uri
    if brand_name is not None:
        update["brand_name"] = brand_name
    if tagline is not None:
        update["tagline"] = tagline
    if primary_color is not None:
        update["primary_color"] = primary_color
    if primary_hover is not None:
        update["primary_hover"] = primary_hover
    if primary_soft is not None:
        update["primary_soft"] = primary_soft
    await _DB.config.update_one({"_id": "branding"}, {"$set": update}, upsert=True)
    return await get_branding()


async def clear_branding_logo() -> dict[str, Any]:
    if _DB is not None:
        await _DB.config.update_one({"_id": "branding"}, {"$set": {"logo_data_uri": ""}}, upsert=True)
    return await get_branding()


def _host_from_url(url: str) -> str:
    """Extract host (without scheme/port) from a Flussonic URL."""
    if not url:
        return ""
    s = url
    if "://" in s:
        s = s.split("://", 1)[1]
    return s.split("/")[0].split(":")[0]


async def stream_outputs(name: str) -> dict[str, Any]:
    """Return ready-to-share playback URLs for a stream."""
    cfg = await _active_config()
    host = cfg["public_host"] or _host_from_url(cfg["url"]) or "your-flussonic-host"
    scheme = "https" if cfg["https"] else "http"
    rtmp_p = cfg["rtmp_port"]
    srt_p = cfg["srt_port"]
    rtmp_host = f"{host}:{rtmp_p}" if rtmp_p not in (1935,) else host

    # Fetch publish_password (if any) for this stream
    publish_password = ""
    try:
        s = await get_stream(name)
        if s:
            publish_password = s.get("publish_password") or ""
    except Exception:  # noqa: BLE001
        publish_password = ""
    pw_q = f"?password={publish_password}" if publish_password else ""

    return {
        "stream": name,
        "outputs": [
            {"label": "HLS (.m3u8)", "protocol": "hls", "url": f"{scheme}://{host}/{name}/index.m3u8"},
            {"label": "HLS Low-Latency", "protocol": "hls", "url": f"{scheme}://{host}/{name}/index_ll.m3u8"},
            {"label": "DASH (.mpd)", "protocol": "dash", "url": f"{scheme}://{host}/{name}/index.mpd"},
            {"label": "RTMP pull", "protocol": "rtmp", "url": f"rtmp://{rtmp_host}/{name}"},
            {"label": "SRT pull", "protocol": "srt", "url": f"srt://{host}:{srt_p}?streamid={name}"},
            {"label": "RTSP", "protocol": "rtsp", "url": f"rtsp://{host}/{name}"},
        ],
        "publish": [
            {
                "label": "RTMP publish (OBS / encoder)",
                "protocol": "rtmp",
                "url": f"rtmp://{rtmp_host}/static/{name}{pw_q}",
                "key": f"{name}{pw_q}",
                "server": f"rtmp://{rtmp_host}/static/",
                "stream_key": f"{name}{pw_q}",
            },
            {
                "label": "SRT publish",
                "protocol": "srt",
                "url": f"srt://{host}:{srt_p}?streamid=publish:{name}"
                       + (f":{publish_password}" if publish_password else ""),
            },
        ],
        "publish_password": publish_password,
        "host": host,
    }
