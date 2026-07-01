"""nginx-rtmp encoder receiver helpers.

Provides:
  - status(): detect whether nginx + the rtmp module + the amixpanel-managed
    config are installed on this VPS.
  - install():  runs `sudo amixpanel-install-nginx-rtmp` in the background,
    streaming stdout/stderr to a log file so the UI can poll for progress.
  - connection_urls(): OBS/vMix/other-encoder ready-to-paste URLs.
"""
from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

import httpx

INSTALL_HELPER = "/usr/local/bin/amixpanel-install-nginx-rtmp"
LOG_PATH = Path(os.environ.get("NGINX_RTMP_LOG", "/tmp/amixpanel-nginx-rtmp.log"))
RTMP_CONF_CANDIDATES = (
    "/etc/nginx/modules-enabled/60-amixpanel-rtmp.conf",
    "/etc/nginx/conf.d/amixpanel-rtmp.conf",
)
HLS_DIR = Path("/var/www/hls")

_state: dict[str, Any] = {
    "running": False,
    "exit_code": None,
    "pid": None,
}


async def status() -> dict[str, Any]:
    """Report current install/running state to the UI."""
    nginx_bin = shutil.which("nginx")
    installed = nginx_bin is not None
    rtmp_module = False
    if installed:
        # Cheapest way to detect if the rtmp module is compiled/loaded.
        try:
            out = subprocess.run(
                [nginx_bin, "-V"], capture_output=True, text=True, timeout=3
            )
            rtmp_module = "rtmp" in (out.stderr or "").lower() or Path(
                "/usr/lib/nginx/modules/ngx_rtmp_module.so"
            ).exists() or Path("/usr/lib64/nginx/modules/ngx_rtmp_module.so").exists()
        except Exception:  # noqa: BLE001
            pass
    conf_present = any(Path(p).exists() for p in RTMP_CONF_CANDIDATES)
    active = False
    try:
        r = subprocess.run(
            ["systemctl", "is-active", "nginx"], capture_output=True, text=True, timeout=2
        )
        active = r.stdout.strip() == "active"
    except Exception:  # noqa: BLE001
        pass
    # A cheap check that :1935 is really listening
    listening_1935 = False
    try:
        _r, w = await asyncio.wait_for(
            asyncio.open_connection("127.0.0.1", 1935), timeout=1.5
        )
        w.close()
        listening_1935 = True
    except Exception:  # noqa: BLE001
        pass
    return {
        "nginx_installed": installed,
        "rtmp_module": rtmp_module,
        "config_present": conf_present,
        "nginx_active": active,
        "rtmp_listening": listening_1935,
        "log_path": str(LOG_PATH),
        "running": _state["running"],
        "exit_code": _state["exit_code"],
    }


async def install(port: int = 1935, app: str = "live") -> dict[str, Any]:
    """Kick off the install helper in the background."""
    if _state["running"]:
        return {"ok": False, "detail": "Install already in progress"}
    if not Path(INSTALL_HELPER).exists():
        return {
            "ok": False,
            "detail": (
                "Helper not found at /usr/local/bin/amixpanel-install-nginx-rtmp. "
                "Re-run `sudo bash install.sh` from the amixpanel source tree."
            ),
        }

    LOG_PATH.write_text("")  # truncate previous log
    cmd = ["sudo", INSTALL_HELPER, "--port", str(port), "--app", app]
    log_fh = LOG_PATH.open("ab")
    proc = subprocess.Popen(cmd, stdout=log_fh, stderr=log_fh, stdin=subprocess.DEVNULL)
    _state["running"] = True
    _state["exit_code"] = None
    _state["pid"] = proc.pid

    async def watcher():
        code = await asyncio.get_event_loop().run_in_executor(None, proc.wait)
        _state["running"] = False
        _state["exit_code"] = code
        try:
            log_fh.close()
        except Exception:  # noqa: BLE001
            pass

    asyncio.create_task(watcher())
    return {"ok": True, "pid": proc.pid, "log_path": str(LOG_PATH)}


async def tail_log(lines: int = 100) -> str:
    if not LOG_PATH.exists():
        return ""
    try:
        # Cheap tail — the log is small
        data = LOG_PATH.read_bytes()[-8192:]
        return data.decode(errors="replace").splitlines()[-lines:] and "\n".join(
            data.decode(errors="replace").splitlines()[-lines:]
        ) or ""
    except Exception:  # noqa: BLE001
        return ""


async def connection_urls(port: int = 1935, app: str = "live", stream_key: str = "mystream") -> dict[str, str]:
    """Return ready-to-paste encoder URLs. Public IP is fetched best-effort."""
    public_ip = "YOUR-VPS-IP"
    try:
        async with httpx.AsyncClient(timeout=3.0) as c:
            r = await c.get("https://api.ipify.org")
            if r.status_code == 200 and r.text.strip():
                public_ip = r.text.strip()
    except Exception:  # noqa: BLE001
        pass
    return {
        "public_ip": public_ip,
        "obs_url": f"rtmp://{public_ip}:{port}/{app}",
        "stream_key": stream_key,
        "hls_url": f"http://{public_ip}/hls/{stream_key}.m3u8",
        "flussonic_pull_url": f"rtmp://127.0.0.1:{port}/{app}/{stream_key}",
    }
