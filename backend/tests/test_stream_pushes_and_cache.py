"""Test stream push targets + server limits cache (iteration 15).

Tests against a LIVE Flussonic instance via the backend on http://127.0.0.1:8001
(public preview URL has a 100s Cloudflare timeout that kills /pushes calls).

Covered:
  - GET/POST/DELETE /api/streams/{name}/pushes (happy path + cleanup)
  - POST /api/streams/{name}/pushes validation (missing url, missing auth, role gating)
  - GET/PUT /api/server/limits with cache_path / cache_size persistence
"""
from __future__ import annotations

import os
import urllib.parse

import pytest
import requests

INTERNAL = "http://127.0.0.1:8001"
ADMIN_EMAIL = "admin@flussonic.io"
ADMIN_PASS = "admin123"

TEST_PUSH_URL = "rtmp://a.rtmp.youtube.com/live2/TEST_pytest_yt"
TEST_PUSH_LABEL = "YouTube"


# ---------- helpers / fixtures ----------
@pytest.fixture(scope="module")
def session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def auth(session) -> str:
    r = session.post(
        f"{INTERNAL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok, f"no token returned: {r.json()}"
    session.headers.update({"Authorization": f"Bearer {tok}"})
    return tok


@pytest.fixture(scope="module")
def live_stream_name(session, auth) -> str:
    """Pick a real stream name without spaces from the live Flussonic."""
    r = session.get(f"{INTERNAL}/api/streams", timeout=30)
    assert r.status_code == 200, f"GET /api/streams failed: {r.status_code}"
    items = r.json()
    assert isinstance(items, list) and items, "no streams on Flussonic"
    # prefer 'Tudn' / 'demo1', else first stream name WITHOUT spaces.
    preferred = ("Tudn", "TvAgro", "demo1")
    for p in preferred:
        if any(it.get("name") == p for it in items):
            return p
    for it in items:
        n = it.get("name") or ""
        if n and " " not in n:
            return n
    pytest.skip("no stream without space found")


# ---------- pushes CRUD ----------
class TestStreamPushes:
    def test_list_empty_or_array(self, session, auth, live_stream_name):
        r = session.get(
            f"{INTERNAL}/api/streams/{live_stream_name}/pushes", timeout=60
        )
        assert r.status_code == 200, f"GET pushes failed: {r.status_code} {r.text}"
        data = r.json()
        assert isinstance(data, list)

    def test_add_then_list_then_delete(self, session, auth, live_stream_name):
        # POST
        r = session.post(
            f"{INTERNAL}/api/streams/{live_stream_name}/pushes",
            json={"url": TEST_PUSH_URL, "label": TEST_PUSH_LABEL},
            timeout=60,
        )
        assert r.status_code == 200, f"POST push failed: {r.status_code} {r.text}"
        body = r.json()
        assert body.get("ok") is True

        # GET — confirm presence
        r2 = session.get(
            f"{INTERNAL}/api/streams/{live_stream_name}/pushes", timeout=60
        )
        assert r2.status_code == 200
        urls = [p.get("url") for p in r2.json()]
        assert TEST_PUSH_URL in urls, f"pushed URL not in list: {urls}"

        # DELETE
        r3 = session.delete(
            f"{INTERNAL}/api/streams/{live_stream_name}/pushes"
            f"?url={urllib.parse.quote(TEST_PUSH_URL, safe='')}",
            timeout=60,
        )
        assert r3.status_code == 200, f"DELETE failed: {r3.status_code} {r3.text}"
        assert r3.json().get("ok") is True

        # Verify removed
        r4 = session.get(
            f"{INTERNAL}/api/streams/{live_stream_name}/pushes", timeout=60
        )
        assert r4.status_code == 200
        urls2 = [p.get("url") for p in r4.json()]
        assert TEST_PUSH_URL not in urls2, f"push still present after delete: {urls2}"

    def test_post_missing_url_returns_400(self, session, auth, live_stream_name):
        r = session.post(
            f"{INTERNAL}/api/streams/{live_stream_name}/pushes",
            json={"label": "Only Label"},
            timeout=20,
        )
        # missing required pydantic field -> 422, OR our 400 check if it defaults to ""
        assert r.status_code in (400, 422), f"unexpected: {r.status_code} {r.text}"

    def test_post_empty_url_returns_400(self, session, auth, live_stream_name):
        r = session.post(
            f"{INTERNAL}/api/streams/{live_stream_name}/pushes",
            json={"url": "", "label": "x"},
            timeout=20,
        )
        assert r.status_code == 400, f"unexpected: {r.status_code} {r.text}"

    def test_post_without_auth_returns_401_or_403(self, live_stream_name):
        anon = requests.Session()
        anon.headers.update({"Content-Type": "application/json"})
        r = anon.post(
            f"{INTERNAL}/api/streams/{live_stream_name}/pushes",
            json={"url": TEST_PUSH_URL},
            timeout=20,
        )
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"


# ---------- server limits cache ----------
class TestServerLimitsCache:
    def test_get_returns_cache_keys(self, session, auth):
        r = session.get(f"{INTERNAL}/api/server/limits", timeout=20)
        assert r.status_code == 200, f"GET limits: {r.status_code} {r.text}"
        d = r.json()
        assert "max_sessions" in d
        assert "cache_path" in d
        assert "cache_size" in d

    def test_put_persists_cache_path_and_size(self, session, auth):
        # Snapshot original
        r0 = session.get(f"{INTERNAL}/api/server/limits", timeout=20)
        assert r0.status_code == 200
        original = r0.json()
        orig_cp = original.get("cache_path")
        orig_cs = original.get("cache_size")

        try:
            new_cp = "/tmp/test-cache"
            new_cs = "10G"
            r1 = session.put(
                f"{INTERNAL}/api/server/limits",
                json={"cache_path": new_cp, "cache_size": new_cs},
                timeout=30,
            )
            assert r1.status_code == 200, f"PUT failed: {r1.status_code} {r1.text}"

            r2 = session.get(f"{INTERNAL}/api/server/limits", timeout=20)
            assert r2.status_code == 200
            d2 = r2.json()
            assert d2.get("cache_path") == new_cp, d2
            assert d2.get("cache_size") == new_cs, d2
        finally:
            # restore
            restore_payload: dict = {}
            if orig_cp is not None:
                restore_payload["cache_path"] = orig_cp
            if orig_cs is not None:
                restore_payload["cache_size"] = orig_cs
            if restore_payload:
                session.put(
                    f"{INTERNAL}/api/server/limits",
                    json=restore_payload,
                    timeout=30,
                )


# ---------- regressions ----------
class TestRegressions:
    def test_srt_publish_format(self, session, auth, live_stream_name):
        r = session.get(
            f"{INTERNAL}/api/streams/{live_stream_name}/outputs", timeout=30
        )
        assert r.status_code == 200, f"outputs: {r.status_code} {r.text}"
        pub = r.json().get("publish") or []
        srt = next((p for p in pub if p.get("protocol") == "srt"), None)
        assert srt is not None, "SRT publish entry missing"
        assert f"#!::r={live_stream_name},m=publish" in srt.get("url", ""), srt

    def test_vod_locations_removed(self, session, auth):
        r = session.get(f"{INTERNAL}/api/vod/locations", timeout=20)
        assert r.status_code == 404, f"expected 404, got {r.status_code}"
