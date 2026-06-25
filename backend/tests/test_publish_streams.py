"""Tests for SRT/RTMP receive (publish) stream creation + outputs format."""
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
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    tok = data.get("token") or data.get("access_token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    yield s


# --- Auth sanity ---
def test_login_and_me(session):
    r = session.get(f"{BASE_URL}/api/auth/me", timeout=10)
    assert r.status_code == 200
    assert r.json().get("email") == ADMIN_EMAIL


# --- SRT receive stream creation + outputs ---
@pytest.fixture(scope="module")
def srt_recv_name(session):
    name = f"TEST_srtrecv_{int(time.time())}"
    r = session.post(
        f"{BASE_URL}/api/streams",
        json={"name": name, "url": "publish://", "title": "Test SRT Receive"},
        timeout=20,
    )
    assert r.status_code in (200, 201), f"Create failed: {r.status_code} {r.text}"
    yield name
    # cleanup
    session.delete(f"{BASE_URL}/api/streams/{name}", timeout=15)


def test_srt_receive_stream_persisted_with_empty_inputs(session, srt_recv_name):
    r = session.get(f"{BASE_URL}/api/streams/{srt_recv_name}", timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    inputs = data.get("inputs") or []
    # Either inputs=[] OR a single publish:// entry — both should map to srt-listen in UI
    assert len(inputs) == 0 or (inputs[0].get("url") or "").startswith("publish://"), (
        f"Expected empty inputs or publish:// — got {inputs}"
    )


def test_srt_receive_outputs_contain_publish_url_with_m_publish(session, srt_recv_name):
    r = session.get(f"{BASE_URL}/api/streams/{srt_recv_name}/outputs", timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    publish = body.get("publish") or []
    srt_pub = next((p for p in publish if p.get("protocol") == "srt"), None)
    assert srt_pub is not None, f"No SRT publish entry: {publish}"
    url = srt_pub.get("url", "")
    # Must use #!::r=NAME,m=publish format
    assert f"#!::r={srt_recv_name},m=publish" in url, f"Bad SRT publish URL: {url}"
    assert url.startswith("srt://"), url
    # Must include a port (auto-detected or default)
    assert ":" in url.split("//", 1)[1].split("?", 1)[0], f"No port in url: {url}"


def test_outputs_contain_srt_pull_with_streamid(session, srt_recv_name):
    r = session.get(f"{BASE_URL}/api/streams/{srt_recv_name}/outputs", timeout=15)
    assert r.status_code == 200
    outs = r.json().get("outputs", [])
    srt_pull = next((o for o in outs if o.get("protocol") == "srt"), None)
    assert srt_pull is not None
    assert f"streamid={srt_recv_name}" in srt_pull["url"]


# --- VOD must remain removed (regression) ---
def test_vod_endpoint_removed(session):
    r = session.get(f"{BASE_URL}/api/vod", timeout=10)
    assert r.status_code in (404, 405), f"VOD endpoint still exists: {r.status_code}"


# --- Auto-detected ports endpoint sanity (via outputs we already test ports; nothing more here) ---
def test_outputs_have_all_protocols(session, srt_recv_name):
    r = session.get(f"{BASE_URL}/api/streams/{srt_recv_name}/outputs", timeout=15)
    outs = r.json().get("outputs", [])
    protocols = {o["protocol"] for o in outs}
    assert {"hls", "rtmp", "srt"}.issubset(protocols), f"Missing protocols: {protocols}"
