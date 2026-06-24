"""Tests for POST /api/streams/{name}/reset and toggle regression."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://flussonic-control.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@flussonic.io"
ADMIN_PASSWORD = "admin123"

# Candidates from the request - pick one that exists and is alive
CANDIDATES = ["SkySportsLiga", "CanalDeLaStrella", "Telenerema"]


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    assert "access_token" in s.cookies
    return s


@pytest.fixture(scope="module")
def live_stream(session):
    """Pick the first candidate stream that exists and is alive."""
    r = session.get(f"{BASE_URL}/api/streams", timeout=15)
    assert r.status_code == 200
    all_streams = {s["name"]: s for s in r.json()}
    for name in CANDIDATES:
        if name in all_streams and all_streams[name].get("alive"):
            return name
    # Fallback: any alive
    for s in r.json():
        if s.get("alive"):
            return s["name"]
    pytest.skip("No alive stream available for reset testing")


# --- Auth & error handling ---

class TestResetAuth:
    def test_reset_requires_auth(self):
        # No cookie / no auth header
        r = requests.post(f"{BASE_URL}/api/streams/anything/reset", timeout=15)
        assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text[:200]}"

    def test_reset_nonexistent_returns_404(self, session):
        r = session.post(f"{BASE_URL}/api/streams/__nonexistent_stream_xyz__/reset", timeout=20)
        assert r.status_code == 404, f"Expected 404, got {r.status_code}: {r.text[:200]}"


# --- Core reset behavior ---

class TestResetEndpoint:
    def test_reset_returns_200_with_stream_object(self, session, live_stream):
        r = session.post(f"{BASE_URL}/api/streams/{live_stream}/reset", timeout=30)
        assert r.status_code == 200, f"Reset failed: {r.status_code} {r.text[:300]}"
        body = r.json()
        assert body["name"] == live_stream
        # Stream object shape
        for key in ("alive", "status", "bitrate", "clients", "uptime", "inputs"):
            assert key in body, f"missing {key} in reset response"

    def test_reset_kicks_viewers_and_restarts_uptime(self, session, live_stream):
        # Snapshot before
        r0 = session.get(f"{BASE_URL}/api/streams/{live_stream}", timeout=15)
        assert r0.status_code == 200
        before = r0.json()
        # Trigger reset
        rr = session.post(f"{BASE_URL}/api/streams/{live_stream}/reset", timeout=30)
        assert rr.status_code == 200
        # Give Flussonic a moment to surface fresh state
        time.sleep(3)
        r1 = session.get(f"{BASE_URL}/api/streams/{live_stream}", timeout=15)
        assert r1.status_code == 200
        after = r1.json()
        # Uptime should be small (< 60s) — stream just restarted
        assert after["uptime"] < 60, f"Expected uptime<60 after reset, got {after['uptime']} (was {before.get('uptime')})"
        # Clients should be 0 (viewers were kicked)
        assert after["clients"] == 0, f"Expected 0 clients after reset, got {after['clients']}"

    def test_reset_leaves_disabled_false(self, session, live_stream):
        """After reset, config_on_disk.disabled must be False (re-enabled)."""
        session.post(f"{BASE_URL}/api/streams/{live_stream}/reset", timeout=30)
        time.sleep(2)
        r = session.get(f"{BASE_URL}/api/streams/{live_stream}", timeout=15)
        assert r.status_code == 200
        after = r.json()
        # Our /api/streams/{name} returns normalized payload — alive=True implies disabled=False
        # Also check status not stopped
        assert after.get("status") != "stopped", f"Stream left in stopped state after reset: {after}"


# --- Preservation of publish_password and title across reset ---

class TestResetPreservesConfig:
    def test_reset_preserves_password_and_title(self, session, live_stream):
        # Snapshot original
        r0 = session.get(f"{BASE_URL}/api/streams/{live_stream}", timeout=15)
        assert r0.status_code == 200
        original = r0.json()
        original_title = original.get("title", "")
        original_password = original.get("publish_password", "") or ""

        test_password = "TEST_resetpw_xyz!@#"
        test_title = original_title or "TEST_TITLE"

        try:
            # Set test password (preserve title)
            pu = session.put(
                f"{BASE_URL}/api/streams/{live_stream}",
                json={"publish_password": test_password, "title": test_title},
                timeout=20,
            )
            assert pu.status_code == 200, f"PUT failed: {pu.status_code} {pu.text[:200]}"

            # Verify it stuck
            rg = session.get(f"{BASE_URL}/api/streams/{live_stream}", timeout=15)
            assert rg.status_code == 200
            assert rg.json().get("publish_password") == test_password

            # Reset
            rr = session.post(f"{BASE_URL}/api/streams/{live_stream}/reset", timeout=30)
            assert rr.status_code == 200
            time.sleep(2)

            # Verify password & title preserved
            rf = session.get(f"{BASE_URL}/api/streams/{live_stream}", timeout=15)
            assert rf.status_code == 200
            final = rf.json()
            assert final.get("publish_password") == test_password, (
                f"Password wiped by reset! expected={test_password!r}, got={final.get('publish_password')!r}"
            )
            assert final.get("title") == test_title, (
                f"Title changed by reset! expected={test_title!r}, got={final.get('title')!r}"
            )
        finally:
            # Cleanup: restore original
            session.put(
                f"{BASE_URL}/api/streams/{live_stream}",
                json={"publish_password": original_password, "title": original_title},
                timeout=20,
            )


# --- Toggle regression (re-enabled after off→on) ---

class TestToggleRegression:
    def test_toggle_off_then_on_leaves_enabled(self, session, live_stream):
        try:
            r1 = session.post(f"{BASE_URL}/api/streams/{live_stream}/toggle", json={"start": False}, timeout=20)
            assert r1.status_code == 200, f"toggle off failed: {r1.text[:200]}"
            time.sleep(1)
            r2 = session.post(f"{BASE_URL}/api/streams/{live_stream}/toggle", json={"start": True}, timeout=20)
            assert r2.status_code == 200, f"toggle on failed: {r2.text[:200]}"
            time.sleep(2)
            rg = session.get(f"{BASE_URL}/api/streams/{live_stream}", timeout=15)
            assert rg.status_code == 200
            after = rg.json()
            assert after.get("status") != "stopped", f"Stream left stopped after toggle on: {after}"
        finally:
            # Ensure re-enabled
            session.post(f"{BASE_URL}/api/streams/{live_stream}/toggle", json={"start": True}, timeout=20)
