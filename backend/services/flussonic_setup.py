"""Native Flussonic install + license management.

Runs the official Flussonic installer (`curl -sSf https://flussonic.com/install.sh | sh`)
in the background, streams stdout/stderr to a log file the frontend can poll,
and updates the panel's config to point at `http://localhost` once finished.

License management uses Flussonic's `/streamer/api/v3/config` to PUT a new
license key — Flussonic reloads the config automatically.
"""
from __future__ import annotations

import asyncio
import os
import shlex
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

import flussonic

LOG_PATH = Path(os.environ.get("FLUSSONIC_INSTALL_LOG", "/tmp/flussonic-install.log"))
INSTALL_SCRIPT_URL = os.environ.get(
    "FLUSSONIC_INSTALL_URL", "https://flussonic.com/install.sh"
)
# Helper installed by install.sh + sudoers entry. We never run `curl | sudo sh`
# directly from the Python process; instead the helper wraps the official command
# and writes status to /var/lib/amixpanel/install.{status,pid}.
INSTALLER_HELPER = "/usr/local/bin/amixpanel-install-flussonic"

_state: dict[str, Any] = {
    "running": False,
    "started_at": None,
    "finished_at": None,
    "exit_code": None,
    "pid": None,
    "license_key": "",
}


# ---------- Install ----------------------------------------------------------
async def detect_flussonic_running() -> dict[str, Any]:
    """Return whether a Flussonic instance is reachable on localhost."""
    out = {"installed": False, "running": False, "version": "", "url": ""}
    if Path("/etc/flussonic/flussonic.conf").exists() or Path("/opt/flussonic").exists():
        out["installed"] = True
    for url in ("http://127.0.0.1:80", "http://127.0.0.1:8080"):
        try:
            async with httpx.AsyncClient(timeout=2.0, follow_redirects=False) as c:
                r = await c.get(f"{url}/erlyvideo/api/server")
                if r.status_code in (200, 401):
                    out["running"] = True
                    out["url"] = url
                    try:
                        out["version"] = (r.json() or {}).get("version", "")
                    except Exception:  # noqa: BLE001
                        pass
                    break
        except httpx.HTTPError:
            continue
    return out


async def get_install_status() -> dict[str, Any]:
    """Return install state + last N KB of log."""
    log_tail = ""
    if LOG_PATH.exists():
        try:
            size = LOG_PATH.stat().st_size
            with LOG_PATH.open("rb") as f:
                if size > 32_768:
                    f.seek(size - 32_768)
                log_tail = f.read().decode("utf-8", errors="replace")
        except OSError:
            pass
    detected = await detect_flussonic_running()
    return {
        **_state,
        "log": log_tail,
        "log_path": str(LOG_PATH),
        "detected": detected,
    }


async def start_install(license_key: str = "") -> dict[str, Any]:
    """Spawn the official Flussonic installer in the background."""
    if _state["running"]:
        return {"ok": False, "error": "Install already running", **_state}

    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("w") as f:
        f.write(f"[{datetime.now(timezone.utc).isoformat()}] Starting Flussonic installer…\n")
        f.write(f"[panel] Using script: {INSTALL_SCRIPT_URL}\n\n")

    if Path(INSTALLER_HELPER).exists():
        cmd = ["sudo", "-n", INSTALLER_HELPER, INSTALL_SCRIPT_URL, license_key or ""]
    else:
        # Fallback: try without helper (works only if backend has root, e.g. dev).
        # The shell pipeline is intentional — that's what Flussonic's docs use.
        oneliner = f"set -o pipefail; curl -fsSL {shlex.quote(INSTALL_SCRIPT_URL)} | sh"
        if license_key:
            oneliner = f"export FLUSSONIC_LICENSE_KEY={shlex.quote(license_key)}; " + oneliner
        cmd = ["bash", "-lc", oneliner]

    log_fp = LOG_PATH.open("ab")
    proc = subprocess.Popen(
        cmd,
        stdout=log_fp,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
    )
    _state.update({
        "running": True,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "finished_at": None,
        "exit_code": None,
        "pid": proc.pid,
    })

    asyncio.create_task(_watch_install(proc, license_key))
    return {"ok": True, **_state}


async def _watch_install(proc: subprocess.Popen, license_key: str) -> None:
    """Background task: wait for the installer, then auto-configure the panel."""
    try:
        while proc.poll() is None:
            await asyncio.sleep(2)
        _state["exit_code"] = proc.returncode
        _state["finished_at"] = datetime.now(timezone.utc).isoformat()
        _state["running"] = False
        with LOG_PATH.open("a") as f:
            f.write(f"\n[panel] Installer finished with exit code {proc.returncode}\n")

        if proc.returncode == 0:
            # Auto-point the panel at the freshly installed Flussonic (which
            # listens on http://localhost on a fresh install).
            await _post_install_autoconfigure(license_key)
    except Exception as e:  # noqa: BLE001
        with LOG_PATH.open("a") as f:
            f.write(f"\n[panel] post-install error: {e}\n")
        _state["running"] = False
        _state["finished_at"] = datetime.now(timezone.utc).isoformat()


async def _post_install_autoconfigure(license_key: str) -> None:
    """After a successful install, wait for Flussonic to come up and store the
    panel's Flussonic config so subsequent API calls work without manual setup."""
    detected = {}
    for _ in range(30):  # up to ~60s
        detected = await detect_flussonic_running()
        if detected["running"]:
            break
        await asyncio.sleep(2)
    if not detected.get("running"):
        with LOG_PATH.open("a") as f:
            f.write("[panel] Flussonic did not respond on localhost within 60s — skipping auto-config\n")
        return
    base = detected["url"]
    with LOG_PATH.open("a") as f:
        f.write(f"[panel] Detected Flussonic at {base}. Saving panel config…\n")
    await flussonic.save_config(
        url=base, user="admin", password="flussonic",
        api_path="/streamer/api/v3",
    )
    if license_key:
        try:
            await set_license_key(license_key)
            with LOG_PATH.open("a") as f:
                f.write("[panel] License key pushed to Flussonic.\n")
        except Exception as e:  # noqa: BLE001
            with LOG_PATH.open("a") as f:
                f.write(f"[panel] Failed to push license key: {e}\n")


# ---------- License ---------------------------------------------------------
async def get_license_status() -> dict[str, Any]:
    """Return license info read from Flussonic + our DB."""
    out: dict[str, Any] = {
        "saved": False, "key_masked": "", "valid_until": "", "edition": "",
        "limits": {}, "reachable": False,
    }
    if flussonic._DB is not None:  # noqa: SLF001
        doc = await flussonic._DB.config.find_one({"_id": "flussonic_license"}) or {}  # noqa: SLF001
        key = doc.get("license_key") or ""
        if key:
            out["saved"] = True
            out["key_masked"] = _mask(key)
    cfg = await flussonic._active_config()  # noqa: SLF001
    if not cfg["url"]:
        return out
    try:
        async with flussonic._make_client(cfg) as c:  # noqa: SLF001
            r = await c.get(f"{cfg['api_path']}/server")
            if r.status_code < 400 and r.headers.get("content-type", "").startswith("application/json"):
                d = r.json() or {}
                out["reachable"] = True
                out["edition"] = d.get("edition") or d.get("license_edition") or ""
                out["valid_until"] = d.get("license_until") or d.get("valid_until") or ""
                lim = {}
                for k in ("max_clients", "max_bitrate", "max_streams"):
                    if k in d:
                        lim[k] = d[k]
                out["limits"] = lim
    except httpx.HTTPError:
        pass
    return out


async def set_license_key(key: str) -> dict[str, Any]:
    """Persist the license in our DB and PUT it to Flussonic so it reloads."""
    if not key or len(key) < 8:
        raise ValueError("License key looks too short")
    if flussonic._DB is not None:  # noqa: SLF001
        await flussonic._DB.config.update_one(  # noqa: SLF001
            {"_id": "flussonic_license"},
            {"$set": {
                "license_key": key,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
            upsert=True,
        )
    cfg = await flussonic._active_config()  # noqa: SLF001
    pushed = False
    push_error = ""
    if cfg["url"]:
        try:
            async with flussonic._make_client(cfg) as c:  # noqa: SLF001
                # Flussonic accepts the license via `key` in the config body.
                r = await c.put(f"{cfg['api_path']}/config", json={"key": key})
                if r.status_code < 400:
                    pushed = True
                else:
                    push_error = f"HTTP {r.status_code}: {r.text[:200]}"
        except httpx.HTTPError as e:
            push_error = str(e)
    status = await get_license_status()
    status["pushed_to_flussonic"] = pushed
    if push_error:
        status["push_error"] = push_error
    return status


def _mask(key: str) -> str:
    if len(key) <= 8:
        return "•" * len(key)
    return key[:4] + "…" + key[-4:]
