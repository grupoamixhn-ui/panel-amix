"""Backend API tests for Flussonic Admin Panel."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://flussonic-control.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@flussonic.io")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")


@pytest.fixture(scope="session")
def auth():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    token = data["token"]
    s.headers.update({"Authorization": f"Bearer {token}"})
    return {"session": s, "token": token, "data": data}


# ---------- Auth ----------
class TestAuth:
    def test_login_success_returns_token_and_cookie(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["email"] == ADMIN_EMAIL
        assert body["role"] == "admin"
        assert isinstance(body["token"], str) and len(body["token"]) > 20
        assert "access_token" in r.cookies

    def test_login_invalid(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong"}, timeout=15)
        assert r.status_code == 401

    def test_me_requires_auth(self):
        r = requests.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 401

    def test_me_with_bearer(self, auth):
        r = auth["session"].get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL

    def test_me_with_cookie(self):
        s = requests.Session()
        s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
        r = s.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 200

    def test_logout_clears_cookie(self):
        s = requests.Session()
        s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
        r = s.post(f"{API}/auth/logout", timeout=15)
        assert r.status_code == 200


# ---------- Server / stats / logs / sessions ----------
class TestServerEndpoints:
    def test_server_info(self, auth):
        r = auth["session"].get(f"{API}/server/info", timeout=15)
        assert r.status_code == 200
        d = r.json()
        for k in ["version", "streams_total", "streams_live", "clients", "bandwidth_bps", "cpu", "memory"]:
            assert k in d

    def test_stats_24_points(self, auth):
        r = auth["session"].get(f"{API}/stats", params={"points": 24}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "series" in d and len(d["series"]) == 24
        p = d["series"][0]
        assert "ts" in p and "clients" in p and "bandwidth" in p

    def test_logs(self, auth):
        r = auth["session"].get(f"{API}/logs", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_sessions(self, auth):
        r = auth["session"].get(f"{API}/sessions", timeout=15)
        assert r.status_code == 200
        sessions = r.json()
        assert isinstance(sessions, list)
        # Verify only running streams contribute
        streams = auth["session"].get(f"{API}/streams", timeout=15).json()
        live_names = {s["name"] for s in streams if s.get("alive")}
        for sess in sessions:
            assert sess["stream"] in live_names


# ---------- Streams CRUD ----------
class TestStreams:
    def test_list_streams_has_seeded(self, auth):
        r = auth["session"].get(f"{API}/streams", timeout=15)
        assert r.status_code == 200
        streams = r.json()
        assert isinstance(streams, list)
        assert len(streams) >= 8

    def test_get_unknown_returns_404(self, auth):
        r = auth["session"].get(f"{API}/streams/__not_exist__", timeout=15)
        assert r.status_code == 404

    def test_create_duplicate_returns_409(self, auth):
        r = auth["session"].post(f"{API}/streams", json={"name": "cam_lobby", "url": "rtsp://x", "title": "dup", "dvr": False}, timeout=15)
        assert r.status_code == 409

    def test_full_crud_flow(self, auth):
        name = f"TEST_{uuid.uuid4().hex[:8]}"
        # CREATE
        r = auth["session"].post(f"{API}/streams", json={"name": name, "url": "rtsp://x/live", "title": "T1", "dvr": False}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["name"] == name and d["title"] == "T1"

        # GET
        r = auth["session"].get(f"{API}/streams/{name}", timeout=15)
        assert r.status_code == 200
        assert r.json()["name"] == name

        # UPDATE
        r = auth["session"].put(f"{API}/streams/{name}", json={"title": "T2", "dvr": True, "url": "rtsp://y/live"}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["title"] == "T2" and d["dvr_enabled"] == True  # noqa: E712
        assert d["inputs"][0]["url"] == "rtsp://y/live"

        # TOGGLE stop
        r = auth["session"].post(f"{API}/streams/{name}/toggle", json={"start": False}, timeout=15)
        assert r.status_code == 200
        assert r.json()["alive"] == False  # noqa: E712

        # TOGGLE start
        r = auth["session"].post(f"{API}/streams/{name}/toggle", json={"start": True}, timeout=15)
        assert r.status_code == 200
        assert r.json()["alive"] == True  # noqa: E712

        # DELETE
        r = auth["session"].delete(f"{API}/streams/{name}", timeout=15)
        assert r.status_code == 200
        r = auth["session"].get(f"{API}/streams/{name}", timeout=15)
        assert r.status_code == 404
