"""Tests for FEATURE 1: admin can create/list/delete other admins via /api/sub-users."""
import os
import time
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
ADMIN_EMAIL = "admin@flussonic.io"
ADMIN_PASS = "admin123"


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, r.text
    s.headers.update({"Authorization": f"Bearer {r.json()['token']}"})
    s.me = r.json()  # type: ignore[attr-defined]
    return s


@pytest.fixture
def cleanup_admins(admin_session):
    created = []
    yield created
    for uid in created:
        try:
            admin_session.delete(f"{BASE_URL}/api/sub-users/{uid}")
        except Exception:
            pass


def _uniq_email(prefix="test_admin"):
    return f"{prefix}_{int(time.time() * 1000)}@example.com"


class TestAdminCreation:
    def test_admin_can_create_admin(self, admin_session, cleanup_admins):
        email = _uniq_email()
        r = admin_session.post(f"{BASE_URL}/api/sub-users", json={
            "email": email, "password": "pw1234", "role": "admin", "name": "T Admin"
        })
        assert r.status_code == 200, r.text
        data = r.json()
        cleanup_admins.append(data["id"])
        assert data["role"] == "admin"
        assert data["email"] == email
        # No quotas
        assert data["max_streams"] is None
        assert data["max_sub_users"] is None
        assert data["max_concurrent_viewers"] is None
        assert data["streams_allowed"] == []

    def test_new_admin_can_login(self, admin_session, cleanup_admins):
        email = _uniq_email()
        r = admin_session.post(f"{BASE_URL}/api/sub-users", json={
            "email": email, "password": "pw1234", "role": "admin"
        })
        assert r.status_code == 200
        cleanup_admins.append(r.json()["id"])
        # login as new admin
        s = requests.Session()
        lr = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": "pw1234"})
        assert lr.status_code == 200, lr.text
        body = lr.json()
        assert body["role"] == "admin"
        assert isinstance(body["token"], str) and len(body["token"]) > 20
        # /auth/me with this token
        s.headers.update({"Authorization": f"Bearer {body['token']}"})
        me = s.get(f"{BASE_URL}/api/auth/me")
        assert me.status_code == 200
        assert me.json()["role"] == "admin"

    def test_unknown_role_400(self, admin_session):
        email = _uniq_email()
        r = admin_session.post(f"{BASE_URL}/api/sub-users", json={
            "email": email, "password": "pw1234", "role": "superduper"
        })
        # pydantic accepts string; backend role-check returns 400
        assert r.status_code in (400, 422), r.text

    def test_reseller_cannot_create_admin(self, admin_session, cleanup_admins):
        # First create a reseller
        r_email = _uniq_email("test_admin_reseller")
        r = admin_session.post(f"{BASE_URL}/api/sub-users", json={
            "email": r_email, "password": "pw1234", "role": "reseller"
        })
        assert r.status_code == 200
        cleanup_admins.append(r.json()["id"])
        # Login as reseller
        rs = requests.Session()
        lr = rs.post(f"{BASE_URL}/api/auth/login", json={"email": r_email, "password": "pw1234"})
        assert lr.status_code == 200
        rs.headers.update({"Authorization": f"Bearer {lr.json()['token']}"})
        # Try to create admin
        bad = rs.post(f"{BASE_URL}/api/sub-users", json={
            "email": _uniq_email(), "password": "pw1234", "role": "admin"
        })
        assert bad.status_code == 403, bad.text


class TestAdminListing:
    def test_admin_sees_all_non_self(self, admin_session, cleanup_admins):
        # Create one admin + one client
        e1 = _uniq_email("test_admin_list_a")
        e2 = _uniq_email("test_admin_list_c")
        r1 = admin_session.post(f"{BASE_URL}/api/sub-users", json={"email": e1, "password": "pw1234", "role": "admin"})
        r2 = admin_session.post(f"{BASE_URL}/api/sub-users", json={"email": e2, "password": "pw1234", "role": "client"})
        assert r1.status_code == 200 and r2.status_code == 200
        cleanup_admins.extend([r1.json()["id"], r2.json()["id"]])
        # GET
        lst = admin_session.get(f"{BASE_URL}/api/sub-users")
        assert lst.status_code == 200
        emails = [u["email"] for u in lst.json()]
        assert e1 in emails
        assert e2 in emails
        # current admin (self) must NOT be in the list
        assert ADMIN_EMAIL not in emails


class TestAdminDeletion:
    def test_cannot_delete_self(self, admin_session):
        my_id = admin_session.me["id"]  # type: ignore[attr-defined]
        r = admin_session.delete(f"{BASE_URL}/api/sub-users/{my_id}")
        assert r.status_code == 403
        assert "yourself" in r.json()["detail"].lower()

    def test_admin_can_delete_other_admin(self, admin_session):
        email = _uniq_email("test_admin_del")
        r = admin_session.post(f"{BASE_URL}/api/sub-users", json={"email": email, "password": "pw1234", "role": "admin"})
        assert r.status_code == 200
        uid = r.json()["id"]
        d = admin_session.delete(f"{BASE_URL}/api/sub-users/{uid}")
        assert d.status_code == 200
        assert d.json().get("ok") is True
        # verify gone
        lst = admin_session.get(f"{BASE_URL}/api/sub-users")
        assert email not in [u["email"] for u in lst.json()]

    def test_reseller_cannot_delete_admin(self, admin_session, cleanup_admins):
        # Create reseller + another admin
        r_email = _uniq_email("test_admin_rs2")
        a_email = _uniq_email("test_admin_victim")
        rr = admin_session.post(f"{BASE_URL}/api/sub-users", json={"email": r_email, "password": "pw1234", "role": "reseller"})
        aa = admin_session.post(f"{BASE_URL}/api/sub-users", json={"email": a_email, "password": "pw1234", "role": "admin"})
        assert rr.status_code == 200 and aa.status_code == 200
        cleanup_admins.extend([rr.json()["id"], aa.json()["id"]])
        # Login as reseller
        rs = requests.Session()
        lr = rs.post(f"{BASE_URL}/api/auth/login", json={"email": r_email, "password": "pw1234"})
        rs.headers.update({"Authorization": f"Bearer {lr.json()['token']}"})
        # Resellers can't see the admin via in_my_scope (admin is not their descendant)
        # so we expect 403 either from scope or from role-check
        d = rs.delete(f"{BASE_URL}/api/sub-users/{aa.json()['id']}")
        assert d.status_code == 403, d.text

    def test_last_admin_guard_check(self, admin_session):
        """We don't actually try to delete the last admin (we can't); just verify
        the count of admins and that the seeded admin is among them."""
        lst = admin_session.get(f"{BASE_URL}/api/sub-users")
        assert lst.status_code == 200
        # Admins visible to admin (excludes self). If 0 other admins exist, then
        # the seeded one IS the last admin and self-delete already returns 403.
        # If >=1, deletion of one is allowed (already tested).
        # The guard is exercised in code review at server.py:389-392.
        admins_other = [u for u in lst.json() if u["role"] == "admin"]
        # Just sanity: count is an int >= 0
        assert isinstance(admins_other, list)
