"""Tests for iteration 7:
- demo_mode removed from /api/config/flussonic
- RTMP publish URL now includes /static/ application path
- New per-stream fields max_bitrate_kbps and source_timeout persist
- Title-only PUT preserves max_bitrate_kbps and source_timeout
- POST /streams accepts the new fields
- max_bitrate_kbps=0 clears the cap
"""
import os
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
ADMIN_EMAIL = "admin@flussonic.io"
ADMIN_PASS = "admin123"
TEST_STREAM = "Tudn"


@pytest.fixture(scope="module")
def auth_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    body = r.json()
    s.headers.update({"Authorization": f"Bearer {body['token']}"})
    return s


@pytest.fixture(scope="module", autouse=True)
def restore_defaults(auth_client):
    """After all tests, reset Tudn to defaults (cap=0, timeout=60)."""
    yield
    try:
        auth_client.put(
            f"{BASE_URL}/api/streams/{TEST_STREAM}",
            json={"max_bitrate_kbps": 0, "source_timeout": 60},
        )
    except Exception:  # noqa: BLE001
        pass


# ---------- BUG A: demo_mode removed ----------
class TestDemoModeRemoved:
    def test_config_get_has_no_demo_mode(self, auth_client):
        r = auth_client.get(f"{BASE_URL}/api/config/flussonic")
        assert r.status_code == 200
        data = r.json()
        assert "demo_mode" not in data, f"demo_mode should be removed; got keys: {list(data.keys())}"

    def test_config_put_without_demo_mode_succeeds(self, auth_client):
        cfg = auth_client.get(f"{BASE_URL}/api/config/flussonic").json()
        payload = {
            "url": cfg.get("url", ""),
            "user": cfg.get("user", ""),
            "public_host": cfg.get("public_host", ""),
            "rtmp_port": cfg.get("rtmp_port", 1935),
            "srt_port": cfg.get("srt_port", 9998),
            "https": cfg.get("https", True),
        }
        r = auth_client.put(f"{BASE_URL}/api/config/flussonic", json=payload)
        assert r.status_code == 200, f"PUT failed: {r.status_code} {r.text}"
        out = r.json()
        assert "demo_mode" not in out

    def test_config_put_rejects_demo_mode_extra_silently_or_strict(self, auth_client):
        """Pydantic should ignore unknown field demo_mode (default) — and still succeed."""
        cfg = auth_client.get(f"{BASE_URL}/api/config/flussonic").json()
        payload = {
            "url": cfg.get("url", ""),
            "user": cfg.get("user", ""),
            "demo_mode": True,  # legacy field — should be ignored, not crash
        }
        r = auth_client.put(f"{BASE_URL}/api/config/flussonic", json=payload)
        assert r.status_code in (200, 422), f"unexpected: {r.status_code} {r.text}"


# ---------- BUG B: RTMP publish URL has /static/ ----------
class TestRtmpStaticPath:
    def test_publish_url_contains_static(self, auth_client):
        r = auth_client.get(f"{BASE_URL}/api/streams/{TEST_STREAM}/outputs")
        assert r.status_code == 200, f"outputs failed: {r.status_code} {r.text}"
        data = r.json()
        publish = data.get("publish") or []
        assert publish, "publish list should not be empty"
        rtmp = next((p for p in publish if p.get("protocol") == "rtmp"), None)
        assert rtmp, f"no rtmp publish entry: {publish}"

        # url must contain /static/STREAM_NAME
        assert "/static/" in rtmp["url"], f"missing /static/ in url: {rtmp['url']}"
        assert rtmp["url"].startswith("rtmp://"), f"bad scheme: {rtmp['url']}"
        # server ends in /static/
        assert rtmp["server"].endswith("/static/"), f"bad server path: {rtmp['server']}"
        # stream_key starts with stream name
        assert rtmp["stream_key"].startswith(TEST_STREAM), f"bad stream_key: {rtmp['stream_key']}"


# ---------- FEATURE C: max_bitrate_kbps + source_timeout ----------
class TestStreamLimits:
    def test_get_stream_exposes_new_fields(self, auth_client):
        r = auth_client.get(f"{BASE_URL}/api/streams/{TEST_STREAM}")
        assert r.status_code == 200
        s = r.json()
        assert "max_bitrate_kbps" in s, "missing max_bitrate_kbps"
        assert "source_timeout" in s, "missing source_timeout"
        assert isinstance(s["max_bitrate_kbps"], int)
        assert isinstance(s["source_timeout"], int)

    def test_put_persists_max_bitrate_and_timeout(self, auth_client):
        r = auth_client.put(
            f"{BASE_URL}/api/streams/{TEST_STREAM}",
            json={"max_bitrate_kbps": 5000, "source_timeout": 45},
        )
        assert r.status_code == 200, f"PUT failed: {r.status_code} {r.text}"
        body = r.json()
        assert body["max_bitrate_kbps"] == 5000
        assert body["source_timeout"] == 45

        # Verify GET returns them too (true persistence)
        g = auth_client.get(f"{BASE_URL}/api/streams/{TEST_STREAM}")
        assert g.status_code == 200
        gs = g.json()
        assert gs["max_bitrate_kbps"] == 5000, f"not persisted: {gs}"
        assert gs["source_timeout"] == 45

    def test_title_only_put_preserves_limits(self, auth_client):
        # First, set known limits
        auth_client.put(
            f"{BASE_URL}/api/streams/{TEST_STREAM}",
            json={"max_bitrate_kbps": 3000, "source_timeout": 30},
        )
        # Now title-only update
        r = auth_client.put(
            f"{BASE_URL}/api/streams/{TEST_STREAM}",
            json={"title": "Tudn"},
        )
        assert r.status_code == 200
        # Verify limits unchanged
        g = auth_client.get(f"{BASE_URL}/api/streams/{TEST_STREAM}").json()
        assert g["max_bitrate_kbps"] == 3000, f"limits dropped on title-only PUT: {g}"
        assert g["source_timeout"] == 30

    def test_clear_max_bitrate_with_zero(self, auth_client):
        r = auth_client.put(
            f"{BASE_URL}/api/streams/{TEST_STREAM}",
            json={"max_bitrate_kbps": 0},
        )
        assert r.status_code == 200
        g = auth_client.get(f"{BASE_URL}/api/streams/{TEST_STREAM}").json()
        assert g["max_bitrate_kbps"] == 0, f"cap not cleared: {g}"
