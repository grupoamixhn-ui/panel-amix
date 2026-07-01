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
    # Legacy single srt_port kept as fallback for older configs
    legacy_srt = int(cfg.get("srt_port") or 9998)
    return {
        "url": (cfg.get("url") or os.environ.get("FLUSSONIC_URL", "")).strip(),
        "user": cfg.get("user", os.environ.get("FLUSSONIC_USER", "")),
        "password": cfg.get("password", os.environ.get("FLUSSONIC_PASS", "")),
        "api_path": (cfg.get("api_path") or os.environ.get("FLUSSONIC_API_PATH") or "/streamer/api/v3").rstrip("/"),
        "public_host": (cfg.get("public_host") or "").strip(),
        "srt_port": legacy_srt,
        "srt_publish_port": int(cfg.get("srt_publish_port") or legacy_srt),
        "srt_play_port": int(cfg.get("srt_play_port") or legacy_srt),
        "rtmp_port": int(cfg.get("rtmp_port") or 1935),
        "http_port": int(cfg.get("http_port") or 80),
        "https_port": int(cfg.get("https_port") or 443),
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
        "srt_publish_port": c["srt_publish_port"],
        "srt_play_port": c["srt_play_port"],
        "rtmp_port": c["rtmp_port"],
        "http_port": c["http_port"],
        "https_port": c["https_port"],
        "https": c["https"],
    }


async def save_config(
    *, url: str, user: str, password: str | None,
    api_path: str | None = None, public_host: str | None = None,
    srt_port: int | None = None, rtmp_port: int | None = None,
    srt_publish_port: int | None = None, srt_play_port: int | None = None,
    http_port: int | None = None, https_port: int | None = None,
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
    if srt_publish_port is not None:
        update["srt_publish_port"] = int(srt_publish_port)
    if srt_play_port is not None:
        update["srt_play_port"] = int(srt_play_port)
    if rtmp_port is not None:
        update["rtmp_port"] = int(rtmp_port)
    if http_port is not None:
        update["http_port"] = int(http_port)
    if https_port is not None:
        update["https_port"] = int(https_port)
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

    # Flussonic v3 publishes stats under various keys depending on version.
    # Critical unit gotcha: `bitrate` / `input_bitrate` are reported in **kbit/s**
    # (Flussonic native UI shows "2281 kbit/s") while `output_bandwidth` /
    # `out_bandwidth` / `inputs_bandwidth` are in bits/sec. We normalize the
    # final value to bits/sec for the panel UI (which calls fmtBitrate(bps)).
    clients = int(
        stats.get("online_clients")
        or stats.get("client_count")
        or stats.get("clients")
        or data.get("clients")
        or 0
    )
    if stats.get("output_bandwidth") or stats.get("out_bandwidth") or stats.get("inputs_bandwidth"):
        bitrate = int(
            stats.get("output_bandwidth")
            or stats.get("out_bandwidth")
            or stats.get("inputs_bandwidth")
            or 0
        )
    else:
        # Fallback: Flussonic returns `bitrate` / `input_bitrate` in **kbps** — convert to bps.
        kbps = int(stats.get("bitrate") or stats.get("input_bitrate") or data.get("bitrate") or 0)
        bitrate = kbps * 1000
    # uptime in seconds — Flussonic sends `opened_at` as ms epoch and `lifetime` as ms.
    # When alive=true → real data session uptime; when running=true but alive=false (source
    # unreachable, retrying) → fall back to "time since stream activated" so the UI shows
    # how long this config has been trying instead of a useless 0.
    import time as _t
    uptime = 0
    running = bool(stats.get("running") or data.get("running"))
    if alive and isinstance(stats.get("lifetime"), (int, float)) and stats["lifetime"] > 0:
        uptime = int(stats["lifetime"] / 1000)
    elif (alive or running) and isinstance(stats.get("opened_at"), (int, float)):
        uptime = max(0, int(_t.time() - stats["opened_at"] / 1000))
    else:
        uptime = int(stats.get("uptime") or data.get("uptime") or 0)
    # Flussonic max_bitrate is in bits/second; expose as kbit/s to the UI
    raw_max_bitrate = data.get("max_bitrate") or 0
    try:
        max_bitrate_kbps = int(raw_max_bitrate) // 1000 if raw_max_bitrate else 0
    except (TypeError, ValueError):
        max_bitrate_kbps = 0
    # Publisher info (IP + protocol) — only meaningful when input is publish://
    # Flussonic v24/v25 exposes the publisher data under different keys depending
    # on whether stats are read from `media_info`, `stats`, `inputs[0].stats`, …
    # Probe every known location so the UI never says "no publisher" while the
    # stream is actually receiving data.
    publish_stats = data.get("stats") or {}
    input_stats = (inputs[0].get("stats") if (inputs and isinstance(inputs[0], dict)) else {}) or {}
    publisher_ip = (
        publish_stats.get("published_from")
        or publish_stats.get("input_addr")
        or publish_stats.get("client_addr")
        or publish_stats.get("remote_addr")
        or input_stats.get("ip")          # Flussonic 24/25: inputs[0].stats.ip
        or input_stats.get("client_addr")
        or input_stats.get("remote_addr")
        or input_stats.get("published_from")
        or data.get("published_from")
        or data.get("input_addr")
        or ""
    )
    # Strip "ip:port" → "ip" so the badge is short
    if publisher_ip and ":" in publisher_ip and publisher_ip.count(":") <= 1:
        publisher_ip = publisher_ip.rsplit(":", 1)[0]
    publisher_proto = (
        publish_stats.get("published_via")
        or input_stats.get("proto")        # Flussonic 24/25: inputs[0].stats.proto
        or input_stats.get("published_via")
        or data.get("published_via")
        or ""
    ).lower()
    # Heuristic: if proto is missing but bitrate>0 and url=publish://, try to infer
    # from the URL prefix that the publisher used (Flussonic sometimes drops the
    # field after the handshake completes).
    if publisher_ip and not publisher_proto:
        publisher_proto = "rtmp"  # safe default for "publish://" w/ a connected peer
    # Per-stream max_sessions lives under `on_play.max_sessions` in Flussonic v24/v25
    on_play = data.get("on_play") or {}
    per_stream_max_sessions = 0
    if isinstance(on_play, dict):
        try:
            per_stream_max_sessions = int(on_play.get("max_sessions") or 0)
        except (TypeError, ValueError):
            per_stream_max_sessions = 0
    # Also accept the legacy top-level key for older builds
    if per_stream_max_sessions == 0:
        try:
            per_stream_max_sessions = int(data.get("max_sessions") or 0)
        except (TypeError, ValueError):
            per_stream_max_sessions = 0
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
        "max_sessions": per_stream_max_sessions,
        "srt_publish_port": int(data.get("srt_publish_port") or 0),
        "srt_publish_passphrase": data.get("srt_publish_passphrase") or "",
        "srt_play_port": int(data.get("srt_play_port") or 0),
        "srt_play_passphrase": data.get("srt_play_passphrase") or "",
        "client_timeout": int(data.get("client_timeout") or 0),
        "publisher_ip": publisher_ip,
        "publisher_proto": publisher_proto,
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
    max_sessions: int | None = None,
    srt_publish_port: int | None = None, srt_publish_passphrase: str | None = None,
    srt_play_port: int | None = None, srt_play_passphrase: str | None = None,
    client_timeout: int | None = None,
) -> dict[str, Any]:
    cfg = await _active_config()
    async with _make_client(cfg) as c:
        body: dict[str, Any] = {"name": name, "title": title}
        body["inputs"] = [{"url": url or "publish://"}]
        if publish_password:
            body["password"] = publish_password
        if max_bitrate_kbps is not None:
            body["max_bitrate"] = int(max_bitrate_kbps) * 1000 if max_bitrate_kbps > 0 else 0
        if source_timeout is not None:
            body["source_timeout"] = int(source_timeout)
        if max_sessions is not None:
            ms = int(max_sessions)
            body["on_play"] = {**(body.get("on_play") or {}), "max_sessions": ms if ms > 0 else 0}
        if srt_publish_port is not None and int(srt_publish_port) > 0:
            body["srt_publish_port"] = int(srt_publish_port)
        if srt_publish_passphrase:  # drop empty strings — Flussonic rejects them
            body["srt_publish_passphrase"] = srt_publish_passphrase
        if srt_play_port is not None and int(srt_play_port) > 0:
            body["srt_play_port"] = int(srt_play_port)
        if srt_play_passphrase:
            body["srt_play_passphrase"] = srt_play_passphrase
        # NOTE: client_timeout is intentionally NOT pushed to Flussonic — it's a
        # server-wide setting in Flussonic 24+ and gets rejected with
        # `unknown_key` when sent on a per-stream PUT. Stored only locally if needed.
        _ = client_timeout  # accepted for API compatibility, ignored
        r = await c.put(f"{cfg['api_path']}/streams/{name}", json=body)
        r.raise_for_status()
        return _normalize_stream(name, r.json() if r.content else body)


async def update_stream(name: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    cfg = await _active_config()
    async with _make_client(cfg) as c:
        g = await c.get(f"{cfg['api_path']}/streams/{name}")
        if g.status_code >= 400:
            return None
        current = g.json() or {}
        merged = dict(current.get("config_on_disk") or {})
        merged.setdefault("name", name)
        if "url" in payload and payload["url"]:
            merged["inputs"] = [{"url": payload["url"]}]
        if "title" in payload:
            merged["title"] = payload["title"]
        if "publish_password" in payload:
            merged["password"] = payload["publish_password"] or ""
        if "max_bitrate_kbps" in payload:
            kbps = payload["max_bitrate_kbps"]
            merged["max_bitrate"] = (int(kbps) * 1000) if kbps and int(kbps) > 0 else 0
        if "source_timeout" in payload:
            merged["source_timeout"] = int(payload["source_timeout"] or 0)
        if "max_sessions" in payload:
            ms = payload["max_sessions"]
            ms_int = int(ms) if ms and int(ms) > 0 else 0
            on_play = dict(merged.get("on_play") or {})
            on_play["max_sessions"] = ms_int
            merged["on_play"] = on_play
        # Per-stream SRT dedicated ports + passphrases
        for key in ("srt_publish_port", "srt_play_port"):
            if key in payload:
                v = payload[key]
                if v is None or v == "" or int(v or 0) <= 0:
                    merged.pop(key, None)
                else:
                    merged[key] = int(v)
        for key in ("srt_publish_passphrase", "srt_play_passphrase"):
            if key in payload:
                v = payload[key] or ""
                if v:
                    merged[key] = v
                else:
                    merged.pop(key, None)
        if "client_timeout" in payload:
            # Flussonic 24+ rejects this as `unknown_key` at stream level — drop silently
            merged.pop("client_timeout", None)
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


async def get_stream_live_stats(name: str) -> dict[str, Any] | None:
    """Per-stream live snapshot used by the in-app Stream monitor: codec info,
    real-time bitrate, in/out bandwidth, viewers and uptime."""
    cfg = await _active_config()
    if not cfg["url"]:
        return None
    async with _make_client(cfg) as c:
        try:
            r = await c.get(f"{cfg['api_path']}/streams/{name}?stats=true")
        except httpx.HTTPError:
            return None
        if r.status_code >= 400:
            return None
        d = r.json() or {}

    stats = d.get("stats") or {}
    media = stats.get("media_info") or {}
    tracks = media.get("tracks") or []
    video: dict[str, Any] = {}
    audio: dict[str, Any] = {}
    for t in tracks:
        if t.get("content") == "video" and not video:
            video = {
                "codec": t.get("codec") or "",
                "profile": t.get("profile") or "",
                "level": t.get("level") or "",
                "width": t.get("width") or 0,
                "height": t.get("height") or 0,
                "fps": t.get("avg_fps") or t.get("fps") or 0,
                "bitrate_kbps": int(t.get("bitrate") or 0),
                "pix_fmt": t.get("pix_fmt") or "",
            }
        elif t.get("content") == "audio" and not audio:
            audio = {
                "codec": t.get("codec") or "",
                "channels": t.get("channels") or 0,
                "sample_rate": t.get("sample_rate") or 0,
                "bitrate_kbps": int(t.get("bitrate") or 0),
            }

    # uptime: prefer lifetime (data session) when alive; fall back to opened_at delta.
    import time as _t
    alive_b = bool(stats.get("alive"))
    running_b = bool(stats.get("running"))
    uptime_s = 0
    if alive_b and isinstance(stats.get("lifetime"), (int, float)) and stats["lifetime"] > 0:
        uptime_s = int(stats["lifetime"] / 1000)
    elif (alive_b or running_b) and isinstance(stats.get("opened_at"), (int, float)):
        uptime_s = max(0, int(_t.time() - stats["opened_at"] / 1000))

    # Bitrates: Flussonic v3 reports `input_bitrate` / `bitrate` in **kbit/s**.
    # The bandwidth-suffixed keys (`out_bandwidth`, `output_bandwidth`,
    # `inputs_bandwidth`) are in bits/sec when present. Normalize for the UI.
    input_kbps = int(stats.get("input_bitrate") or stats.get("bitrate") or 0)
    if input_kbps == 0 and stats.get("inputs_bandwidth"):
        input_kbps = int(stats["inputs_bandwidth"]) // 1000

    # Output bandwidth: Flussonic 24+ doesn't expose this as a single field on
    # /streams/{name}, only cumulative `bytes_out`. Estimate as clients × input
    # bitrate (each viewer pulls ≈ input bitrate). Use exact field when available.
    clients_n = int(stats.get("online_clients") or stats.get("client_count") or 0)
    if stats.get("out_bandwidth") or stats.get("output_bandwidth"):
        output_bps = int(stats.get("out_bandwidth") or stats.get("output_bandwidth") or 0)
    else:
        output_bps = clients_n * input_kbps * 1000

    # Publisher IP/proto — try the same paths as _normalize_stream
    inputs_arr = d.get("inputs") or []
    input_stats_arr = (inputs_arr[0].get("stats") if inputs_arr and isinstance(inputs_arr[0], dict) else {}) or {}
    pub_ip = (
        stats.get("published_from") or stats.get("client_addr") or stats.get("remote_addr")
        or input_stats_arr.get("ip")
        or input_stats_arr.get("client_addr")
        or input_stats_arr.get("remote_addr")
        or ""
    )
    if pub_ip and ":" in pub_ip and pub_ip.count(":") <= 1:
        pub_ip = pub_ip.rsplit(":", 1)[0]
    pub_proto = (
        stats.get("published_via")
        or input_stats_arr.get("proto")
        or input_stats_arr.get("published_via")
        or ""
    ).lower()

    return {
        "ts": datetime.now(timezone.utc).isoformat(),
        "name": name,
        "alive": alive_b,
        "status": stats.get("status") or "",
        "uptime_s": uptime_s,
        "clients": clients_n,
        "input_bitrate_kbps": input_kbps,
        "output_bandwidth_bps": output_bps,
        "bytes_in": int(stats.get("bytes_in") or stats.get("inputs_bytes") or input_stats_arr.get("bytes") or 0),
        "bytes_out": int(stats.get("bytes_out") or stats.get("playback_bytes") or 0),
        "video": video,
        "audio": audio,
        "publisher_ip": pub_ip,
        "publisher_proto": pub_proto,
    }






def _host_from_url(url: str) -> str:
    """Extract host (without scheme/port) from a Flussonic URL."""
    if not url:
        return ""
    s = url
    if "://" in s:
        s = s.split("://", 1)[1]
    return s.split("/")[0].split(":")[0]


# Tiny in-process cache for ports auto-detected from Flussonic's /config
_PORT_CACHE: dict[str, Any] = {"data": None, "expires": 0.0}


async def detect_flussonic_ports() -> dict[str, int]:
    """Read Flussonic's running config and extract real SRT / RTMP ports.

    Returns {"srt_port": N, "rtmp_port": N, "srt_publish_port": N, "srt_play_port": N}
    or empty dict if not reachable. Cached for 30 s to avoid hammering /config.

    Flussonic v23/v24/v25 expose this in several different shapes; we probe all
    of them defensively.
    """
    import time as _t
    now = _t.time()
    if _PORT_CACHE["data"] is not None and _PORT_CACHE["expires"] > now:
        return _PORT_CACHE["data"]  # type: ignore[return-value]

    cfg = await _active_config()
    if not cfg["url"]:
        return {}
    out: dict[str, int] = {}

    def _port_of(value: Any) -> int | None:
        """Extract a port from any of: int, str(int), {"port": N}, [{"port": N}, ...]."""
        if isinstance(value, bool):
            return None
        if isinstance(value, int):
            return value
        if isinstance(value, str) and value.strip().isdigit():
            return int(value.strip())
        if isinstance(value, dict):
            for k in ("port", "listen", "bind"):
                p = _port_of(value.get(k))
                if p:
                    return p
        if isinstance(value, list) and value:
            return _port_of(value[0])
        return None

    try:
        async with _make_client(cfg) as c:
            r = await c.get(f"{cfg['api_path']}/config")
            if r.status_code != 200:
                return {}
            d = r.json() if r.content else {}
            if isinstance(d, dict):
                # 1) Plain `srt: N` or `srt: {port: N}` (single port handles both modes)
                srt_combined = _port_of(d.get("srt"))
                if srt_combined:
                    out["srt_port"] = srt_combined
                    out["srt_publish_port"] = srt_combined
                    out["srt_play_port"] = srt_combined

                # 2) Dedicated publish/play blocks (any shape)
                for key, target in (
                    ("srt_publish", "srt_publish_port"),
                    ("srt_play", "srt_play_port"),
                    # legacy aliases occasionally seen in user-edited configs
                    ("srt_input", "srt_publish_port"),
                    ("srt_output", "srt_play_port"),
                ):
                    p = _port_of(d.get(key))
                    if p:
                        out[target] = p

                # 3) Some installs expose the listeners array `listen` instead of named blocks
                for lst_key in ("listen", "listeners"):
                    listeners = d.get(lst_key)
                    # Newer Flussonic uses listeners as a dict keyed by protocol:
                    #   {"http": [{"port": 80}], "rtmp": [{"port": 1935}], "srt": [{"port": 9998, "role": "publish"}]}
                    if isinstance(listeners, dict):
                        for proto_name, entries in listeners.items():
                            proto = proto_name.lower()
                            if not isinstance(entries, list):
                                entries = [entries]
                            for entry in entries:
                                port = _port_of(entry)
                                if not port:
                                    continue
                                role = ""
                                if isinstance(entry, dict):
                                    role = (entry.get("role") or entry.get("direction") or "").lower()
                                if proto == "rtmp":
                                    out["rtmp_port"] = port
                                elif proto == "srt":
                                    if role in ("publish", "input", "in"):
                                        out["srt_publish_port"] = port
                                    elif role in ("play", "output", "out"):
                                        out["srt_play_port"] = port
                                    else:
                                        out.setdefault("srt_port", port)
                                        out.setdefault("srt_publish_port", port)
                                        out.setdefault("srt_play_port", port)
                    elif isinstance(listeners, list):
                        for entry in listeners:
                            if not isinstance(entry, dict):
                                continue
                            proto = (entry.get("proto") or entry.get("protocol") or "").lower()
                            role = (entry.get("role") or entry.get("direction") or "").lower()
                            port = _port_of(entry.get("port") or entry)
                            if not port:
                                continue
                            if proto == "rtmp":
                                out["rtmp_port"] = port
                            elif proto == "srt":
                                if role in ("publish", "input", "in"):
                                    out["srt_publish_port"] = port
                                elif role in ("play", "output", "out"):
                                    out["srt_play_port"] = port
                                else:
                                    out.setdefault("srt_port", port)
                                    out.setdefault("srt_publish_port", port)
                                    out.setdefault("srt_play_port", port)

                # 4) RTMP port
                rtmp_p = _port_of(d.get("rtmp"))
                if rtmp_p:
                    out["rtmp_port"] = rtmp_p

                # 5) Fallback: if we found play but not publish (or vice versa),
                # mirror so the UI never shows zero.
                if "srt_play_port" in out and "srt_publish_port" not in out:
                    out["srt_publish_port"] = out["srt_play_port"]
                if "srt_publish_port" in out and "srt_play_port" not in out:
                    out["srt_play_port"] = out["srt_publish_port"]
                if "srt_port" not in out and ("srt_publish_port" in out or "srt_play_port" in out):
                    out["srt_port"] = out.get("srt_publish_port") or out["srt_play_port"]
    except Exception:  # noqa: BLE001
        return {}
    _PORT_CACHE["data"] = out
    _PORT_CACHE["expires"] = now + 30
    return out


async def fetch_raw_flussonic_config() -> dict[str, Any]:
    """Return the raw /config payload — admin-only debug aid."""
    cfg = await _active_config()
    if not cfg["url"]:
        return {"error": "Flussonic not configured"}
    try:
        async with _make_client(cfg) as c:
            r = await c.get(f"{cfg['api_path']}/config")
            r.raise_for_status()
            return {"status": r.status_code, "data": r.json() if r.content else {}}
    except Exception as e:  # noqa: BLE001
        return {"error": f"{type(e).__name__}: {e}"}



async def stream_outputs(name: str) -> dict[str, Any]:
    """Return ready-to-share playback URLs for a stream."""
    cfg = await _active_config()
    host = cfg["public_host"] or _host_from_url(cfg["url"]) or "your-flussonic-host"
    scheme = "https" if cfg["https"] else "http"
    # Auto-detect ports from Flussonic config (cached 30s). Saved values in MongoDB
    # win only if the operator explicitly customized them; otherwise we follow
    # whatever Flussonic actually has running.
    detected = await detect_flussonic_ports()
    rtmp_p = detected.get("rtmp_port") or cfg["rtmp_port"]
    srt_play_p = detected.get("srt_play_port") or cfg["srt_play_port"]
    srt_pub_p = detected.get("srt_publish_port") or cfg["srt_publish_port"]
    # Always show the RTMP port explicitly — many encoders don't assume :1935 by
    # default, and operators want the port visible for troubleshooting.
    rtmp_host = f"{host}:{rtmp_p}"
    # HTTP/HTTPS public delivery ports (blank when default 80/443 for pretty URLs)
    http_p = cfg["https_port"] if cfg["https"] else cfg["http_port"]
    port_suffix = "" if http_p in (80, 443) else f":{http_p}"
    hls_host = f"{host}{port_suffix}"

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
            {"label": "HLS (.m3u8)", "protocol": "hls", "url": f"{scheme}://{hls_host}/{name}/index.m3u8"},
            {"label": "HLS Low-Latency", "protocol": "hls", "url": f"{scheme}://{hls_host}/{name}/index_ll.m3u8"},
            {"label": "RTMP pull", "protocol": "rtmp", "url": f"rtmp://{rtmp_host}/static/{name}"},
            {
                "label": "SRT pull (streamid)",
                "protocol": "srt",
                "url": f"srt://{host}:{srt_play_p}?streamid={name}",
                "server": f"srt://{host}:{srt_play_p}",
                "stream_key": name,
                "port": srt_play_p,
                "note": "Most encoders/players (VLC, ffmpeg, IPTV apps) — Flussonic dedicated play port",
            },
            {
                "label": "SRT pull (caller m=request)",
                "protocol": "srt",
                # Flussonic-native streamid format for hardware decoders / Haivision Play Pro
                "url": f"srt://{host}:{srt_play_p}?streamid=#!::r={name},m=request,latency=2000",
                "server": f"srt://{host}:{srt_play_p}",
                "stream_key": f"#!::r={name},m=request,latency=2000",
                "port": srt_play_p,
                "note": "Use when the player requires the full Flussonic streamid",
            },
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
                # Standard SRT URI streamid format for OBS / FFmpeg / hardware encoders.
                # Many encoders accept the full URL; others (OBS) need Server + Stream ID split.
                "url": f"srt://{host}:{srt_pub_p}?streamid=#!::r={name},m=publish",
                "server": f"srt://{host}:{srt_pub_p}",
                "stream_key": f"#!::r={name},m=publish",
            },
        ],
        "publish_password": publish_password,
        "host": host,
    }


# ---------- Service-layer re-exports (facade) -------------------------------
# Domain logic has been moved to services/. We re-export here so existing
# callers (routes/*, server.py) keep working unchanged.
from services.branding import (  # noqa: E402
    get_branding,
    save_branding,
    clear_branding_logo,
    clear_branding_favicon,
)
from services.server_limits import (  # noqa: E402
    get_server_limits,
    set_server_limits,
)
from services.pushes import (  # noqa: E402
    list_stream_pushes,
    add_stream_push,
    remove_stream_push,
)
from services.hardware import get_server_hardware  # noqa: E402




