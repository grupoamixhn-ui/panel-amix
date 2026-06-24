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
    }


async def get_public_config() -> dict[str, Any]:
    """Return config safe to expose to the UI (no password)."""
    c = await _active_config()
    return {
        "url": c["url"],
        "user": c["user"],
        "demo_mode": c["demo_mode"],
        "has_password": bool(c["password"]),
    }


async def save_config(*, url: str, user: str, password: str | None, demo_mode: bool) -> None:
    if _DB is None:
        raise RuntimeError("DB not initialized")
    update: dict[str, Any] = {
        "url": (url or "").strip(),
        "user": user or "",
        "demo_mode": bool(demo_mode),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    # Only overwrite password when caller explicitly provided one (empty string clears it)
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


async def test_connection(*, url: str, user: str, password: str) -> dict[str, Any]:
    """Probe a Flussonic instance without persisting config."""
    if not url:
        return {"ok": False, "error": "URL is required"}
    auth = (user, password) if user else None
    try:
        async with httpx.AsyncClient(base_url=url.rstrip("/"), auth=auth, timeout=8.0) as c:
            r = await c.get("/streamer/api/v3/server")
            if r.status_code in (401, 403):
                return {"ok": False, "error": f"Auth failed ({r.status_code})"}
            r.raise_for_status()
            data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            return {"ok": True, "version": data.get("version", "unknown"), "raw": data}
    except httpx.HTTPError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


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
            "dvr_enabled": name.startswith("dvr") or name in ("news_hd", "sports_ch"),
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
    alive = bool(data.get("alive") if "alive" in data else stats.get("alive", False))
    status = "running" if alive else (data.get("status") or "stopped")
    return {
        "name": name,
        "title": data.get("title") or data.get("name") or name,
        "inputs": inputs,
        "status": status,
        "alive": alive,
        "bitrate": int(stats.get("bitrate") or data.get("bitrate") or 0),
        "clients": int(stats.get("clients") or data.get("clients") or 0),
        "uptime": int(stats.get("uptime") or data.get("uptime") or 0),
        "dvr_enabled": bool((data.get("dvr") or {}).get("enabled") or data.get("dvr_enabled")),
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
        try:
            r = await c.get("/streamer/api/v3/server")
            r.raise_for_status()
            data = r.json()
        except httpx.HTTPError as e:
            return {"mode": "live", "error": str(e), "version": "unreachable",
                    "streams_total": 0, "streams_live": 0, "clients": 0, "bandwidth_bps": 0,
                    "cpu": 0, "memory": 0, "uptime": 0}
        # Try to compute aggregates from /streams if /server is sparse
        try:
            s2 = await c.get("/streamer/api/v3/streams")
            streams = s2.json() if s2.status_code == 200 else []
            if isinstance(streams, dict):
                streams = streams.get("streams", [])
        except httpx.HTTPError:
            streams = []
        live = sum(1 for s in streams if (s.get("alive") or (s.get("stats") or {}).get("alive")))
        clients = sum(int((s.get("stats") or {}).get("clients", 0)) for s in streams)
        bw = sum(int((s.get("stats") or {}).get("bitrate", 0)) for s in streams)
        return {
            **data, "mode": "live",
            "version": data.get("version", "live"),
            "uptime": int(data.get("uptime", 0)),
            "streams_total": len(streams), "streams_live": live,
            "clients": clients, "bandwidth_bps": bw,
            "cpu": data.get("cpu", 0), "memory": data.get("memory", 0),
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
        r = await c.get("/streamer/api/v3/streams")
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
        r = await c.get(f"/streamer/api/v3/streams/{name}")
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return _normalize_stream(name, r.json())


async def create_stream(name: str, url: str, title: str = "", dvr: bool = False) -> dict[str, Any]:
    if await _is_demo():
        _seed_mock()
        if name in _MOCK_STREAMS:
            raise ValueError("stream already exists")
        _MOCK_STREAMS[name] = {
            "name": name, "title": title or name, "inputs": [{"url": url}],
            "status": "running", "alive": True,
            "bitrate": random.randint(2_000_000, 6_000_000), "clients": 0, "uptime": 0,
            "dvr_enabled": dvr, "created_at": datetime.now(timezone.utc).isoformat(),
        }
        _log("info", f"Stream {name} created", name)
        return _MOCK_STREAMS[name]
    cfg = await _active_config()
    async with _make_client(cfg) as c:
        body: dict[str, Any] = {"inputs": [{"url": url}], "title": title}
        if dvr:
            body["dvr"] = {"enabled": True}
        r = await c.put(f"/streamer/api/v3/streams/{name}", json=body)
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
        if "dvr" in payload:
            s["dvr_enabled"] = bool(payload["dvr"])
        _log("info", f"Stream {name} updated", name)
        return s
    cfg = await _active_config()
    body: dict[str, Any] = {}
    if "url" in payload and payload["url"]:
        body["inputs"] = [{"url": payload["url"]}]
    if "title" in payload:
        body["title"] = payload["title"]
    if "dvr" in payload:
        body["dvr"] = {"enabled": bool(payload["dvr"])}
    async with _make_client(cfg) as c:
        r = await c.put(f"/streamer/api/v3/streams/{name}", json=body)
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
        r = await c.delete(f"/streamer/api/v3/streams/{name}")
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
        r = await c.post(f"/streamer/api/v3/streams/{name}/{path}")
        r.raise_for_status()
        # Re-fetch to return up-to-date data
        g = await c.get(f"/streamer/api/v3/streams/{name}")
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
        r = await c.get("/streamer/api/v3/sessions")
        r.raise_for_status()
        data = r.json()
        if isinstance(data, dict):
            data = data.get("sessions", [])
        out = []
        for s in data:
            out.append({
                "id": str(s.get("id") or s.get("session_id") or s.get("token") or ""),
                "stream": s.get("name") or s.get("stream") or "",
                "type": s.get("type") or "play",
                "protocol": (s.get("protocol") or s.get("proto") or "hls").lower(),
                "ip": s.get("ip") or s.get("client_ip") or "",
                "country": s.get("country") or s.get("country_code") or "",
                "user_agent": s.get("user_agent") or s.get("ua") or "",
                "bytes": int(s.get("bytes") or s.get("bytes_out") or 0),
                "started_at": s.get("started_at") or "",
                "bitrate": int(s.get("bitrate") or 0),
            })
        return out


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
