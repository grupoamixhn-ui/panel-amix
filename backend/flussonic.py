"""Flussonic Media Server API client.

When DEMO_MODE is enabled (or no FLUSSONIC_URL is configured) the client
returns realistic mock data so the admin panel works out of the box.

Real mode wraps a small subset of Flussonic's HTTP Admin API (v3):
  GET    /streamer/api/v3/streams
  GET    /streamer/api/v3/streams/{name}
  PUT    /streamer/api/v3/streams/{name}
  DELETE /streamer/api/v3/streams/{name}
  GET    /streamer/api/v3/sessions
  GET    /streamer/api/v3/server
"""
from __future__ import annotations

import os
import secrets
import time
from datetime import datetime, timezone, timedelta
from typing import Any

import httpx

# Cryptographically-secure RNG (used even for demo data per security review)
_rng = secrets.SystemRandom()
random = _rng  # alias so existing call sites stay readable

# In-memory mock database (persists for the process lifetime in demo mode)
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


def _is_demo() -> bool:
    if os.environ.get("DEMO_MODE", "true").lower() == "true":
        return True
    return not os.environ.get("FLUSSONIC_URL")


def _client() -> httpx.AsyncClient:
    base = os.environ.get("FLUSSONIC_URL", "").rstrip("/")
    user = os.environ.get("FLUSSONIC_USER", "")
    pwd = os.environ.get("FLUSSONIC_PASS", "")
    auth = (user, pwd) if user else None
    return httpx.AsyncClient(base_url=base, auth=auth, timeout=10.0)


# ---------- Public API ----------

async def get_server_info() -> dict[str, Any]:
    if _is_demo():
        _seed_mock()
        total = len(_MOCK_STREAMS)
        live = sum(1 for s in _MOCK_STREAMS.values() if s["alive"])
        clients = sum(s["clients"] for s in _MOCK_STREAMS.values())
        bw = sum(s["bitrate"] for s in _MOCK_STREAMS.values())
        return {
            "version": "demo-24.03",
            "uptime": int(time.time() - _BOOTED_AT),
            "mode": "demo",
            "streams_total": total,
            "streams_live": live,
            "clients": clients,
            "bandwidth_bps": bw,
            "cpu": round(20 + random.random() * 30, 1),
            "memory": round(35 + random.random() * 20, 1),
        }
    async with _client() as c:
        r = await c.get("/streamer/api/v3/server")
        r.raise_for_status()
        data = r.json()
        return {**data, "mode": "live"}


async def list_streams() -> list[dict[str, Any]]:
    if _is_demo():
        _seed_mock()
        # tiny variation to simulate live data
        for s in _MOCK_STREAMS.values():
            if s["alive"]:
                s["bitrate"] = max(500_000, s["bitrate"] + random.randint(-50_000, 50_000))
                s["clients"] = max(0, s["clients"] + random.randint(-3, 3))
        return list(_MOCK_STREAMS.values())
    async with _client() as c:
        r = await c.get("/streamer/api/v3/streams")
        r.raise_for_status()
        return r.json()


async def get_stream(name: str) -> dict[str, Any] | None:
    if _is_demo():
        _seed_mock()
        return _MOCK_STREAMS.get(name)
    async with _client() as c:
        r = await c.get(f"/streamer/api/v3/streams/{name}")
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()


async def create_stream(name: str, url: str, title: str = "", dvr: bool = False) -> dict[str, Any]:
    if _is_demo():
        _seed_mock()
        if name in _MOCK_STREAMS:
            raise ValueError("stream already exists")
        _MOCK_STREAMS[name] = {
            "name": name,
            "title": title or name,
            "inputs": [{"url": url}],
            "status": "running",
            "alive": True,
            "bitrate": random.randint(2_000_000, 6_000_000),
            "clients": 0,
            "uptime": 0,
            "dvr_enabled": dvr,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        _log("info", f"Stream {name} created", name)
        return _MOCK_STREAMS[name]
    async with _client() as c:
        body = {"inputs": [{"url": url}], "title": title, "dvr": {"enabled": dvr} if dvr else None}
        r = await c.put(f"/streamer/api/v3/streams/{name}", json=body)
        r.raise_for_status()
        return r.json()


async def update_stream(name: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    if _is_demo():
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
    async with _client() as c:
        r = await c.put(f"/streamer/api/v3/streams/{name}", json=payload)
        r.raise_for_status()
        return r.json()


async def delete_stream(name: str) -> bool:
    if _is_demo():
        _seed_mock()
        if name in _MOCK_STREAMS:
            del _MOCK_STREAMS[name]
            _log("warn", f"Stream {name} deleted", name)
            return True
        return False
    async with _client() as c:
        r = await c.delete(f"/streamer/api/v3/streams/{name}")
        return r.status_code in (200, 204)


async def toggle_stream(name: str, start: bool) -> dict[str, Any] | None:
    if _is_demo():
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
    async with _client() as c:
        path = "restart" if start else "stop"
        r = await c.post(f"/streamer/api/v3/streams/{name}/{path}")
        r.raise_for_status()
        return r.json()


async def list_sessions() -> list[dict[str, Any]]:
    if _is_demo():
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
                    "id": f"sess-{sid:05d}",
                    "stream": s["name"],
                    "type": "play",
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
    async with _client() as c:
        r = await c.get("/streamer/api/v3/sessions")
        r.raise_for_status()
        data = r.json()
        return data if isinstance(data, list) else data.get("sessions", [])


async def get_stats_timeseries(points: int = 30) -> dict[str, Any]:
    """Return time-series for the dashboard charts."""
    if _is_demo():
        _seed_mock()
        now = datetime.now(timezone.utc)
        series = []
        base_clients = sum(s["clients"] for s in _MOCK_STREAMS.values())
        base_bw = sum(s["bitrate"] for s in _MOCK_STREAMS.values())
        for i in range(points, 0, -1):
            ts = now - timedelta(minutes=i)
            jitter_c = random.randint(-20, 20)
            jitter_b = random.randint(-800_000, 800_000)
            series.append({
                "ts": ts.isoformat(),
                "clients": max(0, base_clients + jitter_c),
                "bandwidth": max(0, base_bw + jitter_b),
            })
        return {"series": series}
    # Real mode: synthesize from current snapshot (Flussonic stats endpoints vary by version)
    info = await get_server_info()
    now = datetime.now(timezone.utc)
    series = [{
        "ts": (now - timedelta(minutes=i)).isoformat(),
        "clients": info.get("clients", 0),
        "bandwidth": info.get("bandwidth_bps", 0),
    } for i in range(points, 0, -1)]
    return {"series": series}


async def list_logs(limit: int = 100) -> list[dict[str, Any]]:
    if _is_demo():
        _seed_mock()
        return _MOCK_LOGS[:limit]
    # Real Flussonic doesn't expose a generic logs endpoint via API v3, return empty list
    return []
