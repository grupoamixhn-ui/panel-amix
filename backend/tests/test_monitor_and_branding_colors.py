"""Tests for BUG 1 (monitor metrics CPU/RAM from live Flussonic) +
FEATURE 2 (branding primary/hover/soft colors).

Live preview URL is read from REACT_APP_BACKEND_URL.
Admin creds come from /app/memory/test_credentials.md.
"""
import os
import re
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://flussonic-control.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@flussonic.io"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    token = r.json().get("token")
    assert token
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


# ---------------- BUG 1: Monitor metrics ----------------
class TestMonitorMetrics:
    def test_metrics_endpoint_returns_200(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/monitor/metrics", timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        # required keys
        for k in ("cpu", "memory", "bandwidth_in_bps", "bandwidth_out_bps",
                  "clients", "streams_live", "streams_total", "uptime_s",
                  "cpu_ram_available", "mode", "ts"):
            assert k in data, f"missing key {k}"

    def test_cpu_ram_available_true_and_real_values(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/monitor/metrics", timeout=20)
        data = r.json()
        # In live mode the fix must light up cpu_ram_available + real CPU/mem
        # We only enforce the live-mode contract; DEMO would never hit the bug.
        assert data.get("mode") == "live", f"Backend not in live mode; got {data.get('mode')}"
        assert data["cpu_ram_available"] is True, f"cpu_ram_available is false; warning={data.get('source_warning')}"
        assert isinstance(data["cpu"], (int, float)) and data["cpu"] > 0, f"cpu={data['cpu']}"
        assert isinstance(data["memory"], (int, float)) and data["memory"] > 0, f"memory={data['memory']}"
        assert data["cpu"] <= 100 and data["memory"] <= 100

    def test_bandwidth_clients_uptime_from_config(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/monitor/metrics", timeout=20)
        data = r.json()
        assert data["bandwidth_in_bps"] > 0, "bandwidth_in_bps should be >0 from stats.input_kbit*1000"
        assert data["bandwidth_out_bps"] > 0
        assert isinstance(data["clients"], int) and data["clients"] >= 0
        assert isinstance(data["uptime_s"], int) and data["uptime_s"] > 0
        assert isinstance(data["streams_live"], int)
        assert isinstance(data["streams_total"], int)


# ---------------- FEATURE 2: Branding colors ----------------
_HEX_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")


class TestBrandingColors:
    @pytest.fixture(autouse=True, scope="class")
    def _restore_clean(self, admin_session):
        # Pre-snapshot
        before = admin_session.get(f"{BASE_URL}/api/branding", timeout=10).json()
        yield
        # cleanup — clear the three fields
        files = {
            "primary_color": (None, ""),
            "primary_hover": (None, ""),
            "primary_soft": (None, ""),
        }
        admin_session.post(f"{BASE_URL}/api/branding", files=files,
                           headers={k: v for k, v in admin_session.headers.items() if k != "Content-Type"},
                           timeout=15)

    def test_get_returns_six_color_fields(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/branding", timeout=10)
        assert r.status_code == 200
        data = r.json()
        for k in ("logo_data_uri", "brand_name", "tagline",
                  "primary_color", "primary_hover", "primary_soft"):
            assert k in data, f"missing {k}"

    def _post_form(self, session, fields):
        # Multipart form
        files = {k: (None, v) for k, v in fields.items()}
        headers = {k: v for k, v in session.headers.items() if k != "Content-Type"}
        return session.post(f"{BASE_URL}/api/branding", files=files, headers=headers, timeout=15)

    def test_post_accepts_valid_hex(self, admin_session):
        r = self._post_form(admin_session, {
            "primary_color": "#10B981",
            "primary_hover": "#0E9E70",
            "primary_soft": "#ECFDF5",
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["primary_color"] == "#10B981"
        assert data["primary_hover"] == "#0E9E70"
        assert data["primary_soft"] == "#ECFDF5"
        # Verify GET persists
        g = admin_session.get(f"{BASE_URL}/api/branding", timeout=10).json()
        assert g["primary_color"] == "#10B981"
        assert g["primary_hover"] == "#0E9E70"
        assert g["primary_soft"] == "#ECFDF5"

    def test_post_accepts_lowercase_and_short_and_alpha_hex(self, admin_session):
        # lowercase 6-digit
        r = self._post_form(admin_session, {"primary_color": "#aabbcc"})
        assert r.status_code == 200
        assert r.json()["primary_color"] == "#aabbcc"
        # 3-digit
        r = self._post_form(admin_session, {"primary_color": "#abc"})
        assert r.status_code == 200
        assert r.json()["primary_color"] == "#abc"
        # 8-digit with alpha
        r = self._post_form(admin_session, {"primary_color": "#11223344"})
        assert r.status_code == 200
        assert r.json()["primary_color"] == "#11223344"

    def test_post_rejects_invalid_hex_with_400(self, admin_session):
        for bad in ("blue", "#zzzzzz", "10B981", "#1234", "#12345"):
            r = self._post_form(admin_session, {"primary_color": bad})
            assert r.status_code == 400, f"value {bad} should be rejected, got {r.status_code} {r.text}"

    def test_partial_update_preserves_other_fields(self, admin_session):
        # set all 3
        self._post_form(admin_session, {
            "primary_color": "#222222",
            "primary_hover": "#111111",
            "primary_soft": "#EEEEEE",
        })
        # update only primary
        r = self._post_form(admin_session, {"primary_color": "#333333"})
        assert r.status_code == 200
        data = r.json()
        assert data["primary_color"] == "#333333"
        assert data["primary_hover"] == "#111111"
        assert data["primary_soft"] == "#EEEEEE"

    def test_empty_string_clears_field(self, admin_session):
        # set first
        self._post_form(admin_session, {"primary_color": "#444444"})
        # clear
        r = self._post_form(admin_session, {"primary_color": ""})
        assert r.status_code == 200
        assert r.json()["primary_color"] == ""

    def test_cleanup_clears_colors_for_next_run(self, admin_session):
        r = self._post_form(admin_session, {
            "primary_color": "",
            "primary_hover": "",
            "primary_soft": "",
        })
        assert r.status_code == 200
        data = r.json()
        assert data["primary_color"] == ""
        assert data["primary_hover"] == ""
        assert data["primary_soft"] == ""
