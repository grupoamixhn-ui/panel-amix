"""Panel host + Flussonic hardware / runtime info."""
from __future__ import annotations

import platform
from typing import Any

import httpx

import flussonic  # late-bound _active_config / _make_client


def _read_proc_cpu() -> dict[str, Any]:
    """Read /proc/cpuinfo without external deps. Returns model + core count."""
    info: dict[str, Any] = {"cpu_model": "", "cpu_cores": 0, "cpu_threads": 0}
    try:
        with open("/proc/cpuinfo", "r", encoding="utf-8", errors="ignore") as f:
            text = f.read()
    except OSError:
        return info
    cores_seen: set[str] = set()
    threads = 0
    for block in text.split("\n\n"):
        if not block.strip():
            continue
        threads += 1
        for line in block.splitlines():
            key, _, val = line.partition(":")
            key = key.strip().lower()
            val = val.strip()
            if key == "model name" and not info["cpu_model"]:
                info["cpu_model"] = val
            elif key == "core id":
                cores_seen.add(val)
    info["cpu_cores"] = len(cores_seen) or threads
    info["cpu_threads"] = threads
    return info


def _read_proc_mem() -> dict[str, Any]:
    """Read /proc/meminfo. Returns total + available bytes."""
    out = {"ram_total_bytes": 0, "ram_available_bytes": 0}
    try:
        with open("/proc/meminfo", "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                key, _, rest = line.partition(":")
                rest = rest.strip().split()
                if not rest:
                    continue
                try:
                    kb = int(rest[0])
                except ValueError:
                    continue
                if key == "MemTotal":
                    out["ram_total_bytes"] = kb * 1024
                elif key == "MemAvailable":
                    out["ram_available_bytes"] = kb * 1024
    except OSError:
        pass
    return out


def _read_uptime() -> int:
    try:
        with open("/proc/uptime", "r", encoding="utf-8") as f:
            return int(float(f.read().split()[0]))
    except OSError:
        return 0


async def get_server_hardware() -> dict[str, Any]:
    """Return hardware/runtime info for both the panel host and Flussonic.

    Flussonic info (version, edition, hostname) is read from /streamer/api/v3/config
    or /server when available. Panel host info (CPU model, cores, RAM, kernel)
    comes from /proc + platform, since the panel always runs on Linux."""
    cpu = _read_proc_cpu()
    mem = _read_proc_mem()
    uname = platform.uname()
    panel = {
        "hostname": uname.node,
        "kernel": f"{uname.system} {uname.release}",
        "arch": uname.machine,
        "os": platform.platform(aliased=True, terse=True),
        "cpu_model": cpu["cpu_model"] or "unknown",
        "cpu_cores": cpu["cpu_cores"],
        "cpu_threads": cpu["cpu_threads"],
        "ram_total_bytes": mem["ram_total_bytes"],
        "ram_available_bytes": mem["ram_available_bytes"],
        "uptime_s": _read_uptime(),
    }

    flussonic_info: dict[str, Any] = {
        "version": "", "edition": "", "hostname": "",
        "uptime_s": 0, "reachable": False,
    }
    cfg = await flussonic._active_config()  # noqa: SLF001
    if cfg.get("url"):
        try:
            async with flussonic._make_client(cfg) as c:  # noqa: SLF001
                # Most informative: /config.stats has version + uptime
                try:
                    r = await c.get(f"{cfg['api_path']}/config")
                    if r.status_code < 400 and r.headers.get("content-type", "").startswith("application/json"):
                        payload = r.json() or {}
                        stats = payload.get("stats") or {}
                        flussonic_info["version"] = (
                            payload.get("version") or stats.get("version") or ""
                        )
                        flussonic_info["edition"] = (
                            payload.get("edition") or stats.get("edition") or ""
                        )
                        flussonic_info["hostname"] = (
                            payload.get("hostname") or stats.get("hostname") or ""
                        )
                        try:
                            flussonic_info["uptime_s"] = int(stats.get("uptime") or 0)
                        except (TypeError, ValueError):
                            flussonic_info["uptime_s"] = 0
                        if flussonic_info["version"] or stats:
                            flussonic_info["reachable"] = True
                except httpx.HTTPError:
                    pass
                # Fallback: /server may expose version when /config is blocked
                if not flussonic_info["version"]:
                    try:
                        r2 = await c.get(f"{cfg['api_path']}/server")
                        if r2.status_code < 400 and r2.headers.get("content-type", "").startswith("application/json"):
                            sd = r2.json() or {}
                            flussonic_info["version"] = sd.get("version") or flussonic_info["version"]
                            flussonic_info["hostname"] = sd.get("hostname") or flussonic_info["hostname"]
                            try:
                                flussonic_info["uptime_s"] = int(sd.get("uptime") or flussonic_info["uptime_s"])
                            except (TypeError, ValueError):
                                pass
                            flussonic_info["reachable"] = True
                    except httpx.HTTPError:
                        pass
        except Exception:  # noqa: BLE001 — never break the panel because of a probe
            pass

    return {"panel_host": panel, "flussonic": flussonic_info}
