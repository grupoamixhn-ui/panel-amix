"""Tests for iteration 8 — server-wide limits endpoints.

- GET /api/server/limits requires auth and returns {max_sessions, client_timeout=60, client_timeout_editable=false}
- PUT /api/server/limits with {max_sessions:N} (admin only) updates and persists on Flussonic
- PUT with empty body returns current state unchanged
- Non-admin users get 403
- CLEANUP: restore max_sessions to 400 at end
"""
import os
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
ADMIN_EMAIL = "admin@flussonic.io"
ADMIN_PASS = "admin123"
DEFAULT_MAX_SESSIONS = 400


def _login(email: str, password: str) -> requests.Session:
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    body = r.json()
    s.headers.update({"Authorization": f"Bearer {body['token']}"})
    return s


@pytest.fixture(scope="module")
def admin_client() -> requests.Session:
    return _login(ADMIN_EMAIL, ADMIN_PASS)


@pytest.fixture(scope="module", autouse=True)
def restore_default_max_sessions(admin_client):
    """After all tests, restore max_sessions back to 400 (user-requested baseline)."""
    yield
    try:
        admin_client.put(
            f"{BASE_URL}/api/server/limits", json={"max_sessions": DEFAULT_MAX_SESSIONS}
        )
    except Exception:  # noqa: BLE001
        pass


class TestServerLimitsGet:
    """GET /api/server/limits"""

    def test_get_requires_auth(self):
        # unauthenticated request — must NOT return 200
        r = requests.get(f"{BASE_URL}/api/server/limits")
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code} {r.text}"

    def test_get_returns_expected_shape(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/server/limits")
        assert r.status_code == 200, f"unexpected: {r.status_code} {r.text}"
        data = r.json()
        assert "max_sessions" in data
        assert "client_timeout" in data
        assert "client_timeout_editable" in data
        assert isinstance(data["max_sessions"], int)
        assert data["client_timeout"] == 60
        assert data["client_timeout_editable"] is False


class TestServerLimitsPut:
    """PUT /api/server/limits"""

    def test_put_updates_max_sessions_and_persists(self, admin_client):
        # PUT to 500
        r = admin_client.put(
            f"{BASE_URL}/api/server/limits", json={"max_sessions": 500}
        )
        assert r.status_code == 200, f"PUT failed: {r.status_code} {r.text}"
        body = r.json()
        assert body["max_sessions"] == 500, f"unexpected response: {body}"
        assert body["client_timeout"] == 60
        assert body["client_timeout_editable"] is False

        # Verify GET reads back the new value (real persistence on Flussonic)
        g = admin_client.get(f"{BASE_URL}/api/server/limits")
        assert g.status_code == 200
        gs = g.json()
        assert gs["max_sessions"] == 500, f"value not persisted on Flussonic: {gs}"

    def test_put_empty_body_returns_unchanged(self, admin_client):
        # Set a known value first
        admin_client.put(
            f"{BASE_URL}/api/server/limits", json={"max_sessions": 500}
        )
        # PUT with empty body — should not change anything
        r = admin_client.put(f"{BASE_URL}/api/server/limits", json={})
        assert r.status_code == 200, f"unexpected: {r.status_code} {r.text}"
        body = r.json()
        assert body["max_sessions"] == 500, f"empty PUT changed value: {body}"

    def test_put_restore_400(self, admin_client):
        r = admin_client.put(
            f"{BASE_URL}/api/server/limits", json={"max_sessions": DEFAULT_MAX_SESSIONS}
        )
        assert r.status_code == 200
        assert r.json()["max_sessions"] == DEFAULT_MAX_SESSIONS

        g = admin_client.get(f"{BASE_URL}/api/server/limits")
        assert g.json()["max_sessions"] == DEFAULT_MAX_SESSIONS


class TestServerLimitsAdminOnly:
    """PUT requires admin role — reseller/client must get 403."""

    def _ensure_user(self, admin_client, email: str, password: str, role: str) -> bool:
        """Create user via /api/sub-users. Returns True if created or already exists."""
        r = admin_client.post(
            f"{BASE_URL}/api/sub-users",
            json={"email": email, "password": password, "role": role, "name": f"TEST {role}"},
        )
        if r.status_code in (200, 201):
            return True
        if r.status_code in (400, 409):
            # already exists OR other validation — try login anyway
            return True
        return False

    def test_non_admin_put_returns_403(self, admin_client):
        email = "TEST_reseller@flussonic.io"
        password = "Reseller#123"
        created = self._ensure_user(admin_client, email, password, "reseller")
        if not created:
            pytest.skip("Could not provision non-admin user for 403 test")
        try:
            user_client = _login(email, password)
        except AssertionError as e:
            pytest.skip(f"Reseller login failed: {e}")
        r = user_client.put(
            f"{BASE_URL}/api/server/limits", json={"max_sessions": 999}
        )
        assert r.status_code == 403, f"expected 403 for non-admin, got {r.status_code} {r.text}"
        # Confirm value was not changed
        g = admin_client.get(f"{BASE_URL}/api/server/limits")
        assert g.json()["max_sessions"] != 999, "max_sessions changed despite 403"
