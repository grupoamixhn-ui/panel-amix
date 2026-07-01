"""Tests for self-hosted installer download endpoints:
  GET  /api/download/installer/info     (public)
  GET  /api/download/installer          (public, file download)
  POST /api/download/installer/rebuild  (admin only)
"""

import hashlib
import io
import os
import re
import tarfile

import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@flussonic.io"
ADMIN_PASS = "admin123"


# ---------- fixtures ----------

@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def reseller_session(admin_session):
    """Create a temporary reseller sub-user and return their logged-in session."""
    email = "test_installer_reseller@example.com"
    password = "ResellerPass123!"
    # try to create; ignore 409 (already exists from a prior run)
    r = admin_session.post(
        f"{API}/sub-users",
        json={
            "email": email,
            "password": password,
            "role": "reseller",
            "name": "TEST Installer Reseller",
        },
    )
    assert r.status_code in (200, 201, 409), f"create reseller failed: {r.status_code} {r.text}"

    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"reseller login failed: {r.status_code} {r.text}"
    yield s

    # cleanup: delete reseller via admin
    try:
        users = admin_session.get(f"{API}/sub-users").json()
        for u in users:
            if u.get("email") == email:
                admin_session.delete(f"{API}/sub-users/{u['id']}")
                break
    except Exception:
        pass


# ---------- /info ----------

class TestInstallerInfo:
    def test_info_public_no_auth_returns_200(self):
        anon = requests.Session()
        r = anon.get(f"{API}/download/installer/info")
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("filename", "version", "size_bytes", "sha256", "download_url", "curl_oneliner"):
            assert k in body, f"missing key: {k}"

    def test_info_filename_pattern(self):
        body = requests.get(f"{API}/download/installer/info").json()
        assert re.match(r"^amixpanel-\d.+\.tar\.gz$", body["filename"]), body["filename"]

    def test_info_sha256_format(self):
        body = requests.get(f"{API}/download/installer/info").json()
        assert re.match(r"^[0-9a-f]{64}$", body["sha256"]), body["sha256"]
        assert isinstance(body["size_bytes"], int)
        assert body["size_bytes"] > 1000

    def test_info_https_scheme_via_xfp(self):
        """When fronted by an https proxy, download_url should use https."""
        r = requests.get(f"{API}/download/installer/info")
        body = r.json()
        # Since BASE_URL is https, the ingress sets X-Forwarded-Proto=https
        if BASE_URL.startswith("https://"):
            assert body["download_url"].startswith("https://"), body["download_url"]
            assert "https://" in body["curl_oneliner"]
            # download_url path correctness
            assert body["download_url"].endswith("/api/download/installer")

    def test_info_curl_oneliner_contains_filename_and_install_script(self):
        body = requests.get(f"{API}/download/installer/info").json()
        assert body["filename"] in body["curl_oneliner"]
        assert "install/install.sh" in body["curl_oneliner"]


# ---------- /installer (download) ----------

class TestInstallerDownload:
    def test_download_returns_gzip(self):
        r = requests.get(f"{API}/download/installer")
        assert r.status_code == 200
        ct = r.headers.get("content-type", "")
        assert "application/gzip" in ct or "application/x-gzip" in ct, ct
        # gzip magic
        assert r.content[:2] == b"\x1f\x8b", "not a gzip stream"

    def test_download_sha_and_size_match_info(self):
        info = requests.get(f"{API}/download/installer/info").json()
        r = requests.get(f"{API}/download/installer")
        assert r.status_code == 200
        body_bytes = r.content
        assert len(body_bytes) == info["size_bytes"], (
            f"length mismatch: bytes={len(body_bytes)} vs info.size_bytes={info['size_bytes']}"
        )
        sha = hashlib.sha256(body_bytes).hexdigest()
        assert sha == info["sha256"], f"sha mismatch: download={sha} info={info['sha256']}"

    def test_tarball_contents_required_files_and_forbidden_paths(self):
        r = requests.get(f"{API}/download/installer")
        assert r.status_code == 200
        tf = tarfile.open(fileobj=io.BytesIO(r.content), mode="r:gz")
        try:
            names = tf.getnames()
            # Strip the top dir (amixpanel-VERSION/) and check known files
            required_suffixes = [
                "/install/install.sh",
                "/install/uninstall.sh",
                "/install/README.md",
                "/install/make-release.sh",
                "/backend/server.py",
                "/backend/requirements.txt",
                "/frontend/package.json",
                "/README.md",
                "/VERSION",
            ]
            for suffix in required_suffixes:
                assert any(n.endswith(suffix) for n in names), f"missing in tarball: {suffix}\nsample: {names[:10]}"

            # Forbidden: no .env, node_modules, .venv, __pycache__, test_reports, .git
            forbidden_substrings = [
                "/.env",
                "node_modules",
                ".venv",
                "__pycache__",
                "test_reports",
                "/.git/",
            ]
            for sub in forbidden_substrings:
                bad = [n for n in names if sub in n]
                assert not bad, f"forbidden entries containing {sub!r}: {bad[:5]}"

            # install.sh must be executable
            install_sh = next((m for m in tf.getmembers() if m.name.endswith("/install/install.sh")), None)
            assert install_sh is not None
            assert install_sh.mode & 0o111, f"install.sh not executable: mode={oct(install_sh.mode)}"
        finally:
            tf.close()


# ---------- /rebuild ----------

class TestInstallerRebuild:
    def test_rebuild_requires_auth(self):
        anon = requests.Session()
        r = anon.post(f"{API}/download/installer/rebuild")
        assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text}"

    def test_rebuild_forbidden_for_non_admin(self, reseller_session):
        r = reseller_session.post(f"{API}/download/installer/rebuild")
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"

    def test_rebuild_as_admin_returns_ok(self, admin_session):
        r = admin_session.post(f"{API}/download/installer/rebuild")
        assert r.status_code == 200, f"rebuild failed: {r.status_code} {r.text}"
        body = r.json()
        assert body.get("ok") is True
        assert body.get("filename", "").startswith("amixpanel-")
        assert body.get("filename", "").endswith(".tar.gz")
        assert isinstance(body.get("size_bytes"), int) and body["size_bytes"] > 1000

    def test_rebuild_then_info_sha_matches_new_file(self, admin_session):
        rb = admin_session.post(f"{API}/download/installer/rebuild")
        assert rb.status_code == 200
        rb_body = rb.json()
        # Now /info must reflect the freshly built file
        info = requests.get(f"{API}/download/installer/info").json()
        assert info["filename"] == rb_body["filename"], (
            f"info.filename={info['filename']} vs rebuild.filename={rb_body['filename']}"
        )
        assert info["size_bytes"] == rb_body["size_bytes"]
        # And the actual download bytes hash to the advertised sha
        dl = requests.get(f"{API}/download/installer")
        assert dl.status_code == 200
        sha = hashlib.sha256(dl.content).hexdigest()
        assert sha == info["sha256"]
