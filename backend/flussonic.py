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
    env_demo = os.environ.get("DEMO_MODE", "true").lower() == "true"
    return {
        "url": (cfg.get("url") or os.environ.get("FLUSSONIC_URL", "")).strip(),
        "user": cfg.get("user", os.environ.get("FLUSSONIC_USER", "")),
        "password": cfg.get("password", os.environ.get("FLUSSONIC_PASS", "")),
        "demo_mode": cfg["demo_mode"] if "demo_mode" in cfg else env_demo,
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
        "demo_mode": c["demo_mode"],
        "has_password": bool(c["password"]),
        "api_path": c["api_path"],
        "public_host": c["public_host"],
        "srt_port": c["srt_port"],
        "rtmp_port": c["rtmp_port"],
        "https": c["https"],
    }


async def save_config(
    *, url: str, user: str, password: str | None, demo_mode: bool,
    api_path: str | None = None, public_host: str | None = None,
    srt_port: int | None = None, rtmp_port: int | None = None,
    https: bool | None = None,
) -> None:
    if _DB is None:
        raise RuntimeError("DB not initialized")
    update: dict[str, Any] = {
        "url": (url or "").strip(),
        "user": user or "",
        "demo_mode": bool(demo_mode),
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


async def _is_demo() -> bool:
    cfg = await _active_config()
    return bool(cfg["demo_mode"]) or not cfg["url"]


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


# ---------- Mock data ----------
_MOCK_STREAMS: dict[str, dict[str, Any]] = {}
_MOCK_LOGS: list[dict[str, Any]] = []
_BOOTED_AT = time.time()


def _seed_mock() -> None:
    if _MOCK_STREAMS:
        return
    samples = [
        ("cam_lobby", "rtsp://192.168.1.21/live", "running", 4_512_000, 124),
        ("cam_parking", "rtsp://192.168.1.22/live", "running", 2_180_000, 38),
        ("news_hd", "udp://239.0.0.10:1234", "running", 8_900_000, 1532),
        ("sports_ch", "udp://239.0.0.11:1234", "running", 7_120_000, 980),
        ("movies_hd", "file:///storage/movies/loop.mp4", "running", 5_400_000, 412),
        ("backup_feed", "rtmp://ingest.example.com/live/key", "stopped", 0, 0),
        ("studio_a", "srt://ingest.example.com:9000", "running", 6_300_000, 211),
        ("dvr_archive", "file:///storage/archive/01.mp4", "error", 0, 0),
    ]
    for name, src, status, bitrate, clients in samples:
        _MOCK_STREAMS[name] = {
            "name": name,
            "title": name.replace("_", " ").title(),
            "inputs": [{"url": src}],
            "status": status,
            "alive": status == "running",
            "bitrate": bitrate,
            "clients": clients,
            "uptime": random.randint(120, 86400) if status == "running" else 0,
            "created_at": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 90))).isoformat(),
        }
    levels = ["info", "warn", "error", "info", "info", "debug"]
    msgs = [
        "Stream {n} started",
        "Client connected to {n} from 203.0.113.{ip}",
        "DVR segment written for {n}",
        "Source reconnect attempt on {n}",
        "Auth challenge failed for {n}",
        "Bitrate spike detected on {n} ({br} kbps)",
        "Session closed on {n}",
    ]
    now = datetime.now(timezone.utc)
    for i in range(40):
        n = random.choice(list(_MOCK_STREAMS.keys()))
        msg = random.choice(msgs).format(n=n, ip=random.randint(1, 250), br=random.randint(1000, 9000))
        _MOCK_LOGS.append({
            "ts": (now - timedelta(seconds=i * 17)).isoformat(),
            "level": random.choice(levels),
            "source": "flussonic",
            "stream": n,
            "message": msg,
        })


def _log(level: str, message: str, stream: str | None = None) -> None:
    _MOCK_LOGS.insert(0, {
        "ts": datetime.now(timezone.utc).isoformat(),
        "level": level,
        "source": "panel",
        "stream": stream or "-",
        "message": message,
    })
    del _MOCK_LOGS[500:]


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
    }


# ---------- Public API ----------
async def get_server_info() -> dict[str, Any]:
    if await _is_demo():
        _seed_mock()
        total = len(_MOCK_STREAMS)
        live = sum(1 for s in _MOCK_STREAMS.values() if s["alive"])
        clients = sum(s["clients"] for s in _MOCK_STREAMS.values())
        bw = sum(s["bitrate"] for s in _MOCK_STREAMS.values())
        return {
            "version": "demo-24.03", "uptime": int(time.time() - _BOOTED_AT), "mode": "demo",
            "streams_total": total, "streams_live": live, "clients": clients,
            "bandwidth_bps": bw,
            "cpu": round(20 + random.random() * 30, 1),
            "memory": round(35 + random.random() * 20, 1),
        }
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
    if await _is_demo():
        _seed_mock()
        for s in _MOCK_STREAMS.values():
            if s["alive"]:
                s["bitrate"] = max(500_000, s["bitrate"] + random.randint(-50_000, 50_000))
                s["clients"] = max(0, s["clients"] + random.randint(-3, 3))
        return list(_MOCK_STREAMS.values())
    cfg = await _active_config()
    async with _make_client(cfg) as c:
        r = await c.get(f"{cfg['api_path']}/streams")
        r.raise_for_status()
        data = r.json()
        if isinstance(data, dict):
            data = data.get("streams", [])
        return [_normalize_stream(s.get("name") or s.get("entry") or "?", s) for s in data]


async def get_stream(name: str) -> dict[str, Any] | None:
    if await _is_demo():
        _seed_mock()
        return _MOCK_STREAMS.get(name)
    cfg = await _active_config()
    async with _make_client(cfg) as c:
        r = await c.get(f"{cfg['api_path']}/streams/{name}")
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return _normalize_stream(name, r.json())


async def create_stream(name: str, url: str, title: str = "") -> dict[str, Any]:
    if await _is_demo():
        _seed_mock()
        if name in _MOCK_STREAMS:
            raise ValueError("stream already exists")
        _MOCK_STREAMS[name] = {
            "name": name, "title": title or name, "inputs": [{"url": url}],
            "status": "running", "alive": True,
            "bitrate": random.randint(2_000_000, 6_000_000), "clients": 0, "uptime": 0,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        _log("info", f"Stream {name} created", name)
        return _MOCK_STREAMS[name]
    cfg = await _active_config()
    async with _make_client(cfg) as c:
        body: dict[str, Any] = {"inputs": [{"url": url}], "title": title}
        r = await c.put(f"{cfg['api_path']}/streams/{name}", json=body)
        r.raise_for_status()
        return _normalize_stream(name, r.json() if r.content else body)


async def update_stream(name: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    if await _is_demo():
        _seed_mock()
        s = _MOCK_STREAMS.get(name)
        if not s:
            return None
        if "url" in payload and payload["url"]:
            s["inputs"] = [{"url": payload["url"]}]
        if "title" in payload:
            s["title"] = payload["title"]
        _log("info", f"Stream {name} updated", name)
        return s
    cfg = await _active_config()
    body: dict[str, Any] = {}
    if "url" in payload and payload["url"]:
        body["inputs"] = [{"url": payload["url"]}]
    if "title" in payload:
        body["title"] = payload["title"]
    async with _make_client(cfg) as c:
        r = await c.put(f"{cfg['api_path']}/streams/{name}", json=body)
        r.raise_for_status()
        return _normalize_stream(name, r.json() if r.content else body)


async def delete_stream(name: str) -> bool:
    if await _is_demo():
        _seed_mock()
        if name in _MOCK_STREAMS:
            del _MOCK_STREAMS[name]
            _log("warn", f"Stream {name} deleted", name)
            return True
        return False
    cfg = await _active_config()
    async with _make_client(cfg) as c:
        r = await c.delete(f"{cfg['api_path']}/streams/{name}")
        return r.status_code in (200, 204)


async def toggle_stream(name: str, start: bool) -> dict[str, Any] | None:
    if await _is_demo():
        _seed_mock()
        s = _MOCK_STREAMS.get(name)
        if not s:
            return None
        s["alive"] = start
        s["status"] = "running" if start else "stopped"
        s["bitrate"] = random.randint(2_000_000, 6_000_000) if start else 0
        s["clients"] = 0 if not start else s["clients"]
        _log("info", f"Stream {name} {'started' if start else 'stopped'}", name)
        return s
    cfg = await _active_config()
    async with _make_client(cfg) as c:
        path = "restart" if start else "stop"
        r = await c.post(f"{cfg['api_path']}/streams/{name}/{path}")
        r.raise_for_status()
        # Re-fetch to return up-to-date data
        g = await c.get(f"{cfg['api_path']}/streams/{name}")
        return _normalize_stream(name, g.json()) if g.status_code == 200 else None


async def list_sessions() -> list[dict[str, Any]]:
    if await _is_demo():
        _seed_mock()
        sessions: list[dict[str, Any]] = []
        sid = 1
        protocols = ["hls", "dash", "rtmp", "webrtc", "rtsp"]
        countries = ["US", "BR", "DE", "IN", "ES", "JP", "GB", "FR"]
        now = datetime.now(timezone.utc)
        for s in _MOCK_STREAMS.values():
            if not s["alive"]:
                continue
            for _ in range(min(s["clients"], 12)):
                sessions.append({
                    "id": f"sess-{sid:05d}", "stream": s["name"], "type": "play",
                    "protocol": random.choice(protocols),
                    "ip": f"203.0.113.{random.randint(1,254)}",
                    "country": random.choice(countries),
                    "user_agent": random.choice(["VLC/3.0", "Chrome/120", "Safari/17", "ExoPlayer/2"]),
                    "bytes": random.randint(1_000_000, 500_000_000),
                    "started_at": (now - timedelta(seconds=random.randint(30, 7200))).isoformat(),
                    "bitrate": random.randint(800_000, 6_000_000),
                })
                sid += 1
        return sessions
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
    if await _is_demo():
        _seed_mock()
        now = datetime.now(timezone.utc)
        series = []
        base_clients = sum(s["clients"] for s in _MOCK_STREAMS.values())
        base_bw = sum(s["bitrate"] for s in _MOCK_STREAMS.values())
        for i in range(points, 0, -1):
            ts = now - timedelta(minutes=i)
            series.append({
                "ts": ts.isoformat(),
                "clients": max(0, base_clients + random.randint(-20, 20)),
                "bandwidth": max(0, base_bw + random.randint(-800_000, 800_000)),
            })
        return {"series": series}
    info = await get_server_info()
    now = datetime.now(timezone.utc)
    series = [{
        "ts": (now - timedelta(minutes=i)).isoformat(),
        "clients": info.get("clients", 0),
        "bandwidth": info.get("bandwidth_bps", 0),
    } for i in range(points, 0, -1)]
    return {"series": series}


async def list_logs(limit: int = 100) -> list[dict[str, Any]]:
    if await _is_demo():
        _seed_mock()
        return _MOCK_LOGS[:limit]
    return []


async def get_branding() -> dict[str, Any]:
    if _DB is None:
        return {"logo_data_uri": "", "brand_name": "", "tagline": ""}
    doc = await _DB.config.find_one({"_id": "branding"}) or {}
    return {
        "logo_data_uri": doc.get("logo_data_uri", ""),
        "brand_name": doc.get("brand_name", ""),
        "tagline": doc.get("tagline", ""),
    }


async def save_branding(*, logo_data_uri: str | None = None, brand_name: str | None = None, tagline: str | None = None) -> dict[str, Any]:
    if _DB is None:
        raise RuntimeError("DB not initialized")
    update: dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if logo_data_uri is not None:
        update["logo_data_uri"] = logo_data_uri
    if brand_name is not None:
        update["brand_name"] = brand_name
    if tagline is not None:
        update["tagline"] = tagline
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
            {"label": "RTMP publish (OBS / encoder)", "protocol": "rtmp", "url": f"rtmp://{rtmp_host}/{name}", "key": name},
            {"label": "SRT publish", "protocol": "srt", "url": f"srt://{host}:{srt_p}?streamid=publish:{name}"},
        ],
        "host": host,
    }
