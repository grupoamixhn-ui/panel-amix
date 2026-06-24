"""Backend tests for Monitor metrics endpoint and per-stream publish_password feature.

Tests run against the live external URL (REACT_APP_BACKEND_URL) and expect a real
Flussonic backend at oniptv.pro (/server endpoint is blocked by reverse-proxy 404
— this is the expected scenario these tests cover)."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://flussonic-control.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@flussonic.io"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
               timeout=15)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    body = r.json()
    assert "token" in body
    # cookie is set via httpOnly; session jar should have it
    assert any(c.name == "access_token" for c in s.cookies)
    return s


@pytest.fixture(scope="module")
def first_stream(session):
    r = session.get(f"{BASE_URL}/api/streams", timeout=15)
    assert r.status_code == 200
    streams = r.json()
    assert isinstance(streams, list) and len(streams) > 0, "No streams available on live server to test against"
    name = streams[0]["name"]
    original_title = streams[0].get("title") or name
    yield name
    # restore original title on teardown so test doesn't mutate seed data permanently
    try:
        session.put(f"{BASE_URL}/api/streams/{name}",
                    json={"title": original_title, "publish_password": ""}, timeout=15)
    except Exception:
        pass


# ---------- Monitor ----------
class TestMonitor:
    def test_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/monitor/metrics", timeout=15)
        assert r.status_code == 401

    def test_payload_shape_and_cpu_ram_unavailable(self, session):
        r = session.get(f"{BASE_URL}/api/monitor/metrics", timeout=15)
        assert r.status_code == 200
        d = r.json()
        # required fields
        for k in ("ts", "cpu", "memory", "bandwidth_in_bps", "bandwidth_out_bps",
                  "clients", "streams_live", "streams_total",
                  "cpu_ram_available", "source_warning", "mode"):
            assert k in d, f"Missing field {k}"
        assert d["mode"] == "live"
        # oniptv.pro proxy blocks /server -> cpu_ram_available must be False with non-empty warning
        assert d["cpu_ram_available"] is False
        assert isinstance(d["source_warning"], str) and len(d["source_warning"]) > 0
        # Bandwidth/streams should still be populated from /streams
        assert isinstance(d["streams_total"], int) and d["streams_total"] > 0
        assert isinstance(d["bandwidth_out_bps"], int)
        assert isinstance(d["clients"], int)


# ---------- publish_password ----------
class TestPublishPassword:
    def test_set_clear_and_title_only_update(self, session, first_stream):
        name = first_stream
        pw = "TestPw_!@#$%^&*"  # special chars

        # 1. SET
        r = session.put(f"{BASE_URL}/api/streams/{name}",
                        json={"publish_password": pw}, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("publish_password") == pw

        # GET verifies persistence
        time.sleep(0.5)
        r = session.get(f"{BASE_URL}/api/streams/{name}", timeout=20)
        assert r.status_code == 200
        assert r.json().get("publish_password") == pw

        # 2. Title-only update must preserve password
        r = session.put(f"{BASE_URL}/api/streams/{name}",
                        json={"title": "TEST_title_only"}, timeout=20)
        assert r.status_code == 200
        time.sleep(0.5)
        r = session.get(f"{BASE_URL}/api/streams/{name}", timeout=20)
        assert r.status_code == 200
        got = r.json()
        assert got.get("publish_password") == pw, "title-only update wiped password"
        assert got.get("title") == "TEST_title_only"

        # 3. Outputs should include ?password=... and OBS split
        r = session.get(f"{BASE_URL}/api/streams/{name}/outputs", timeout=20)
        assert r.status_code == 200
        out = r.json()
        assert out.get("publish_password") == pw
        pub0 = out["publish"][0]
        assert f"?password={pw}" in pub0["url"]
        assert pub0.get("server", "").startswith("rtmp://")
        assert f"?password={pw}" in pub0.get("stream_key", "")

        # 4. CLEAR
        r = session.put(f"{BASE_URL}/api/streams/{name}",
                        json={"publish_password": ""}, timeout=20)
        assert r.status_code == 200
        time.sleep(0.5)
        r = session.get(f"{BASE_URL}/api/streams/{name}", timeout=20)
        assert r.status_code == 200
        assert (r.json().get("publish_password") or "") == ""

        # Outputs no longer contain ?password=
        r = session.get(f"{BASE_URL}/api/streams/{name}/outputs", timeout=20)
        assert r.status_code == 200
        out = r.json()
        assert (out.get("publish_password") or "") == ""
        assert "?password=" not in out["publish"][0]["url"]
        assert "?password=" not in out["publish"][0].get("stream_key", "")
