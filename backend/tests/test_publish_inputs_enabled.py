"""End-to-end verification that streams created via the admin panel
persist `inputs=[{url:'publish://'}]` on the live Flussonic at oniptv.pro.

This guarantees Flussonic's native UI shows
"Publication: Allow to publish — Enabled" (not the blank radio state the user
originally reported).
"""
from __future__ import annotations

import asyncio
import os
import time

import httpx
import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

# Use local backend directly per request brief.
BACKEND = "http://127.0.0.1:8001"
ADMIN_EMAIL = "admin@flussonic.io"
ADMIN_PASSWORD = "admin123"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://127.0.0.1:27017")
DB_NAME = os.environ.get("DB_NAME", "flussonic_admin")


# ---------- shared fixtures ----------
@pytest.fixture(scope="module")
def session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(
        f"{BACKEND}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    tok = r.json().get("token")
    assert tok, "no token in login response"
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def flussonic_cfg() -> dict:
    """Read live Flussonic creds straight from MongoDB."""
    async def _load():
        c = AsyncIOMotorClient(MONGO_URL)
        try:
            db = c[DB_NAME]
            doc = await db.config.find_one({"_id": "flussonic"})
            assert doc, "config.flussonic doc missing"
            return {
                "url": (doc.get("url") or "").rstrip("/"),
                "user": doc.get("user") or "",
                "password": doc.get("password") or "",
                "api_path": (doc.get("api_path") or "/streamer/api/v3").rstrip("/"),
            }
        finally:
            c.close()
    cfg = asyncio.get_event_loop().run_until_complete(_load())
    assert cfg["url"], "Flussonic URL missing in DB"
    return cfg


async def _flussonic_get_stream(cfg: dict, name: str) -> dict:
    auth = (cfg["user"], cfg["password"]) if cfg["user"] else None
    async with httpx.AsyncClient(base_url=cfg["url"], auth=auth, timeout=15.0) as c:
        r = await c.get(f"{cfg['api_path']}/streams/{name}")
        assert r.status_code == 200, f"Flussonic GET {name} -> {r.status_code} {r.text[:200]}"
        return r.json()


# ---------- THE MAIN VERIFICATION ----------
@pytest.fixture(scope="module")
def stream_name(session: requests.Session) -> str:
    name = f"TEST_pub_enabled_{int(time.time())}"
    r = session.post(
        f"{BACKEND}/api/streams",
        json={"name": name, "url": "publish://", "title": "pubtest"},
        timeout=20,
    )
    assert r.status_code in (200, 201), f"Create failed: {r.status_code} {r.text}"
    yield name
    # cleanup
    session.delete(f"{BACKEND}/api/streams/{name}", timeout=15)


def test_create_persists_publish_inputs_on_flussonic(session, flussonic_cfg, stream_name):
    """POST /api/streams → Flussonic config_on_disk.inputs must be [{url:'publish://'}]."""
    data = asyncio.get_event_loop().run_until_complete(
        _flussonic_get_stream(flussonic_cfg, stream_name)
    )
    cfg_on_disk = data.get("config_on_disk") or {}
    inputs = cfg_on_disk.get("inputs")
    assert inputs == [{"url": "publish://"}], (
        f"config_on_disk.inputs mismatch on CREATE — expected [{{'url':'publish://'}}], "
        f"got {inputs!r} (full config_on_disk={cfg_on_disk!r})"
    )


def test_update_keeps_publish_inputs_on_flussonic(session, flussonic_cfg, stream_name):
    """PUT /api/streams/{name} with url=publish:// must keep inputs=[{url:'publish://'}]."""
    r = session.put(
        f"{BACKEND}/api/streams/{stream_name}",
        json={"url": "publish://"},
        timeout=20,
    )
    assert r.status_code == 200, f"Update failed: {r.status_code} {r.text}"

    data = asyncio.get_event_loop().run_until_complete(
        _flussonic_get_stream(flussonic_cfg, stream_name)
    )
    cfg_on_disk = data.get("config_on_disk") or {}
    inputs = cfg_on_disk.get("inputs")
    assert inputs == [{"url": "publish://"}], (
        f"config_on_disk.inputs mismatch on UPDATE — expected [{{'url':'publish://'}}], "
        f"got {inputs!r} (full config_on_disk={cfg_on_disk!r})"
    )


# ---------- Regressions ----------
def test_vod_locations_returns_404(session):
    r = session.get(f"{BACKEND}/api/vod/locations", timeout=10)
    assert r.status_code == 404, f"VOD locations still present: {r.status_code} {r.text[:200]}"


def test_outputs_srt_publish_contains_m_publish(session, stream_name):
    r = session.get(f"{BACKEND}/api/streams/{stream_name}/outputs", timeout=15)
    assert r.status_code == 200, r.text
    publish = r.json().get("publish") or []
    srt = next((p for p in publish if p.get("protocol") == "srt"), None)
    assert srt is not None, f"No SRT publish entry: {publish}"
    assert f"#!::r={stream_name},m=publish" in srt["url"], (
        f"SRT publish URL missing #!::r={stream_name},m=publish — got {srt['url']!r}"
    )
