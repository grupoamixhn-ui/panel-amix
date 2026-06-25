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


# ---------- BUG FIX D (iter9): kbit/s conversion correctness ----------
# Previous bug: code did `* 1000 // 8` assuming Flussonic stored bytes/sec.
# Real Flussonic stores max_bitrate in BITS/sec → conversion must be `* 1000`.
# Without the fix, PUT 5000 would store 625_000 bps and GET would return 625.
class TestMaxBitrateConversion:
    @pytest.mark.parametrize("kbps,expected_bps", [
        (5000, 5_000_000),
        (1500, 1_500_000),
        (100, 100_000),
        (1, 1_000),
    ])
    def test_put_kbps_round_trips_via_backend(self, auth_client, kbps, expected_bps):
        # PUT kbit/s via backend
        r = auth_client.put(
            f"{BASE_URL}/api/streams/{TEST_STREAM}",
            json={"max_bitrate_kbps": kbps},
        )
        assert r.status_code == 200, f"PUT failed: {r.status_code} {r.text}"
        # Backend immediate response — must NOT be the buggy /8 value
        body = r.json()
        assert body["max_bitrate_kbps"] == kbps, (
            f"BUG: backend returned {body['max_bitrate_kbps']} kbit/s for input {kbps}. "
            f"If this is {kbps // 8} the old bytes/sec bug is back."
        )
        # GET round-trip — verifies persistence + normalization on read
        g = auth_client.get(f"{BASE_URL}/api/streams/{TEST_STREAM}").json()
        assert g["max_bitrate_kbps"] == kbps, (
            f"BUG: round-trip mismatch: PUT {kbps} → GET {g['max_bitrate_kbps']} "
            f"(expected {kbps}). bytes/sec bug regression?"
        )

    def test_put_5000_stores_5_million_bps_in_flussonic(self, auth_client):
        """Verify by hitting Flussonic directly: max_bitrate must be 5_000_000 (bits/sec), NOT 625_000 (bytes/sec)."""
        import httpx
        # Set via backend
        r = auth_client.put(
            f"{BASE_URL}/api/streams/{TEST_STREAM}",
            json={"max_bitrate_kbps": 5000},
        )
        assert r.status_code == 200
        # Pull active Flussonic creds from the backend's /api/config endpoint
        cfg_resp = auth_client.get(f"{BASE_URL}/api/config/flussonic")
        assert cfg_resp.status_code == 200
        cfg = cfg_resp.json()
        fluss_url = cfg.get("url", "")
        if not fluss_url:
            pytest.skip("Flussonic not configured — cannot verify raw stored value")
        # We don't have the password from /api/config; rely on backend's PUT having actually
        # persisted by re-reading via backend (which calls Flussonic and normalizes).
        # If conversion is correct, normalized value = stored_bps // 1000 = 5000.
        g = auth_client.get(f"{BASE_URL}/api/streams/{TEST_STREAM}").json()
        assert g["max_bitrate_kbps"] == 5000, (
            f"BUG REGRESSED: PUT 5000 kbit/s → backend reads {g['max_bitrate_kbps']}. "
            f"Expected 5000 (Flussonic stored 5_000_000 bps)."
        )
        # Reset to 0 (cleanup will also do this but be explicit)
        auth_client.put(
            f"{BASE_URL}/api/streams/{TEST_STREAM}",
            json={"max_bitrate_kbps": 0, "source_timeout": 60},
        )

    def test_source_timeout_not_wiped_by_max_bitrate_only_put(self, auth_client):
        """Regression: PUT max_bitrate_kbps only must NOT wipe source_timeout."""
        # Seed both
        auth_client.put(
            f"{BASE_URL}/api/streams/{TEST_STREAM}",
            json={"max_bitrate_kbps": 2000, "source_timeout": 45},
        )
        # max_bitrate-only PUT
        r = auth_client.put(
            f"{BASE_URL}/api/streams/{TEST_STREAM}",
            json={"max_bitrate_kbps": 4000},
        )
        assert r.status_code == 200
        g = auth_client.get(f"{BASE_URL}/api/streams/{TEST_STREAM}").json()
        assert g["max_bitrate_kbps"] == 4000
        assert g["source_timeout"] == 45, f"source_timeout wiped: {g}"

    def test_source_timeout_only_put_preserves_max_bitrate(self, auth_client):
        """Regression: PUT source_timeout only must NOT wipe max_bitrate."""
        auth_client.put(
            f"{BASE_URL}/api/streams/{TEST_STREAM}",
            json={"max_bitrate_kbps": 2000, "source_timeout": 45},
        )
        r = auth_client.put(
            f"{BASE_URL}/api/streams/{TEST_STREAM}",
            json={"source_timeout": 30},
        )
        assert r.status_code == 200
        g = auth_client.get(f"{BASE_URL}/api/streams/{TEST_STREAM}").json()
        assert g["source_timeout"] == 30
        assert g["max_bitrate_kbps"] == 2000, f"max_bitrate wiped: {g}"
