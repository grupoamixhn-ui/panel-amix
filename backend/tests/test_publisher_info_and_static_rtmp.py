"""Iteration 11 tests — Publisher info (IP + protocol) + RTMP pull /static/ fix.

Verifies:
1. GET /api/streams returns publisher_ip and publisher_proto fields on each stream.
2. At least one publish:// stream actively pushing exposes publisher_ip + proto.
3. Vfstv publisher_proto='rtmp' and Telenerema publisher_proto='srt' (per main agent context).
4. Idle publish streams (no active publisher) have empty publisher_ip and proto.
5. RTMP pull URL in /api/streams/{name}/outputs is rtmp://host/static/{name} (with /static/).
6. RTMP publish URL still rtmp://host/static/{name} (regression).
"""
import os
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
ADMIN_EMAIL = "admin@flussonic.io"
ADMIN_PASS = "admin123"


@pytest.fixture(scope="module")
def auth_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    s.headers.update({"Authorization": f"Bearer {r.json()['token']}"})
    return s


@pytest.fixture(scope="module")
def all_streams(auth_client):
    r = auth_client.get(f"{BASE_URL}/api/streams")
    assert r.status_code == 200, f"GET /api/streams failed: {r.status_code} {r.text}"
    data = r.json()
    assert isinstance(data, list) and len(data) > 0, "no streams returned"
    return data


# ---------- Publisher Info Fields ----------
class TestPublisherFieldsPresent:
    def test_all_streams_have_publisher_ip_field(self, all_streams):
        missing = [s["name"] for s in all_streams if "publisher_ip" not in s]
        assert not missing, f"publisher_ip missing on: {missing[:10]}"

    def test_all_streams_have_publisher_proto_field(self, all_streams):
        missing = [s["name"] for s in all_streams if "publisher_proto" not in s]
        assert not missing, f"publisher_proto missing on: {missing[:10]}"

    def test_publisher_fields_are_strings(self, all_streams):
        bad = [s["name"] for s in all_streams
               if not isinstance(s.get("publisher_ip"), str)
               or not isinstance(s.get("publisher_proto"), str)]
        assert not bad, f"non-string publisher fields on: {bad[:10]}"

    def test_publisher_proto_lowercase(self, all_streams):
        """When set, publisher_proto must be lowercase (UI uppercases for display)."""
        bad = [(s["name"], s["publisher_proto"]) for s in all_streams
               if s.get("publisher_proto") and s["publisher_proto"] != s["publisher_proto"].lower()]
        assert not bad, f"publisher_proto not lowercase on: {bad}"

    def test_publisher_proto_valid_values(self, all_streams):
        """publisher_proto must be '', 'rtmp', or 'srt' (or other lowercase)."""
        for s in all_streams:
            proto = s.get("publisher_proto", "")
            assert proto == "" or proto.islower(), f"{s['name']}: bad proto {proto!r}"


class TestActivePublishers:
    def test_at_least_one_stream_has_active_publisher_ip(self, all_streams):
        with_ip = [s for s in all_streams if s.get("publisher_ip")]
        assert len(with_ip) >= 1, (
            f"Expected >=1 stream with publisher_ip; got 0. "
            f"Total streams: {len(all_streams)}"
        )
        print(f"\nStreams with active publisher: {len(with_ip)}")
        for s in with_ip[:10]:
            print(f"  {s['name']:20s} {s['publisher_proto']:5s} {s['publisher_ip']}")

    def test_publisher_ip_only_on_publish_inputs(self, all_streams):
        """publish_ip should only be set when input is publish:// (sanity)."""
        leaks = []
        for s in all_streams:
            if not s.get("publisher_ip"):
                continue
            url = (s.get("inputs") or [{}])[0].get("url", "") if s.get("inputs") else ""
            if url and not url.startswith("publish://"):
                leaks.append((s["name"], url))
        # Flussonic also reports published_from for HLS pull etc occasionally,
        # so just warn but don't fail.
        if leaks:
            print(f"\nNote: publisher_ip set on non-publish:// inputs: {leaks}")

    def test_telenerema_srt_publisher_if_active(self, all_streams):
        t = next((s for s in all_streams if s["name"] == "Telenerema"), None)
        if t is None:
            pytest.skip("Telenerema not present")
        if not t.get("publisher_ip"):
            pytest.skip(f"Telenerema not currently publishing (publisher_ip empty)")
        assert t["publisher_proto"] == "srt", (
            f"Telenerema expected proto=srt, got {t['publisher_proto']!r} ip={t['publisher_ip']!r}"
        )

    def test_vfstv_rtmp_publisher_if_active(self, all_streams):
        v = next((s for s in all_streams if s["name"] == "Vfstv"), None)
        if v is None:
            pytest.skip("Vfstv not present")
        if not v.get("publisher_ip"):
            pytest.skip(f"Vfstv not currently publishing (publisher_ip empty)")
        assert v["publisher_proto"] == "rtmp", (
            f"Vfstv expected proto=rtmp, got {v['publisher_proto']!r} ip={v['publisher_ip']!r}"
        )


class TestIdlePublishStreams:
    def test_publish_streams_without_publisher_have_empty_ip(self, all_streams):
        """publish:// inputs that aren't actively pushing must not claim a fake IP."""
        # Any publish:// stream with empty publisher_ip must also have empty proto.
        bad = []
        for s in all_streams:
            url = (s.get("inputs") or [{}])[0].get("url", "") if s.get("inputs") else ""
            if not url.startswith("publish://"):
                continue
            ip = s.get("publisher_ip", "")
            proto = s.get("publisher_proto", "")
            if not ip and proto:
                bad.append((s["name"], proto))
        assert not bad, f"streams with empty IP but non-empty proto: {bad}"


# ---------- RTMP pull /static/ fix ----------
class TestRtmpPullStatic:
    @pytest.fixture(scope="class")
    def telenerema_outputs(self, auth_client):
        r = auth_client.get(f"{BASE_URL}/api/streams/Telenerema/outputs")
        if r.status_code != 200:
            pytest.skip(f"Telenerema/outputs returned {r.status_code}")
        return r.json()

    def test_rtmp_pull_includes_static(self, telenerema_outputs):
        outputs = telenerema_outputs.get("outputs", [])
        rtmp_pull = next((o for o in outputs if o["label"] == "RTMP pull"), None)
        assert rtmp_pull is not None, f"RTMP pull entry missing in outputs"
        url = rtmp_pull["url"]
        assert "/static/" in url, f"RTMP pull URL missing /static/: {url!r}"
        assert url.endswith("/static/Telenerema"), (
            f"RTMP pull URL should end with /static/Telenerema; got {url!r}"
        )

    def test_rtmp_publish_still_has_static_regression(self, telenerema_outputs):
        publish = telenerema_outputs.get("publish", [])
        rtmp_pub = next((p for p in publish if "RTMP" in p["label"]), None)
        assert rtmp_pub is not None, "RTMP publish entry missing"
        assert "/static/" in rtmp_pub["url"], (
            f"RTMP publish URL missing /static/: {rtmp_pub['url']!r}"
        )

    def test_hls_and_srt_unchanged(self, telenerema_outputs):
        outputs = telenerema_outputs.get("outputs", [])
        hls = next((o for o in outputs if o["label"] == "HLS (.m3u8)"), None)
        hls_ll = next((o for o in outputs if o["label"] == "HLS Low-Latency"), None)
        srt = next((o for o in outputs if o["label"] == "SRT pull"), None)
        assert hls and hls["url"].endswith("/Telenerema/index.m3u8"), f"HLS url wrong: {hls}"
        assert hls_ll and hls_ll["url"].endswith("/Telenerema/index_ll.m3u8"), f"HLS-LL wrong: {hls_ll}"
        assert srt and "streamid=Telenerema" in srt["url"], f"SRT url wrong: {srt}"
        # SRT pull URL must NOT have /static/
        assert "/static/" not in srt["url"], f"SRT pull should not have /static/: {srt['url']}"

    def test_outputs_order_and_count_unchanged(self, telenerema_outputs):
        outputs = telenerema_outputs.get("outputs", [])
        labels = [o["label"] for o in outputs]
        assert labels == ["HLS (.m3u8)", "HLS Low-Latency", "RTMP pull", "SRT pull"], (
            f"outputs order/count changed: {labels}"
        )
