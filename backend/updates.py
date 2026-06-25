"""Self-update endpoints for the Flussonic Admin panel.

Exposes:
- GET  /api/updates/status         current version, source config, available version, last check
- POST /api/updates/config         set source (github/url) + auto-check interval
- POST /api/updates/check          force a "check for updates" against configured source
- POST /api/updates/upload         admin uploads a .tar.gz to /var/lib/flussonic-admin/updates/
- POST /api/updates/apply          apply pending update (mode=quick|full)
- POST /api/updates/rollback       restore previous backup

A background task polls the configured source every N hours and updates the
``latest_available_version`` field so the UI can show an "Update available" badge.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import shutil
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

logger = logging.getLogger("flussonic-admin.updates")

ROOT_DIR = Path(__file__).resolve().parent.parent
APP_DIR = Path("/opt/flussonic-admin")
SPOOL_DIR = Path("/var/lib/flussonic-admin/updates")
UPDATE_HELPER = "/usr/local/bin/flussonic-admin-update"

# Module-level state (kept in MongoDB too, this is the in-memory mirror)
_db = None
_check_task: asyncio.Task | None = None


# ----- helpers -----
def _read_version_file(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8").strip() or "unknown"
    except Exception:  # noqa: BLE001
        return "unknown"


def current_version() -> str:
    # Prefer the installed /opt VERSION (production), then the repo root VERSION (dev)
    for p in (APP_DIR / "VERSION", ROOT_DIR / "VERSION"):
        if p.is_file():
            return _read_version_file(p)
    return "dev"


def _is_helper_available() -> bool:
    return Path(UPDATE_HELPER).exists() and os.access(UPDATE_HELPER, os.X_OK)


async def _load_cfg() -> dict[str, Any]:
    doc = await _db.config.find_one({"_id": "updates"}) or {}
    doc.pop("_id", None)
    return {
        "source_type": doc.get("source_type", "none"),     # github | url | upload | none
        "github_repo": doc.get("github_repo", ""),         # "owner/repo"
        "github_token": doc.get("github_token", ""),       # optional, for private repos
        "custom_url": doc.get("custom_url", ""),           # https://.../flussonic-admin-*.tar.gz OR metadata endpoint
        "auto_check_hours": int(doc.get("auto_check_hours", 6)),
        "auto_check_enabled": bool(doc.get("auto_check_enabled", True)),
        "last_check": doc.get("last_check"),
        "latest_available_version": doc.get("latest_available_version", ""),
        "latest_available_url": doc.get("latest_available_url", ""),
        "latest_available_notes": doc.get("latest_available_notes", ""),
        "last_error": doc.get("last_error", ""),
    }


async def _save_cfg(cfg: dict[str, Any]) -> None:
    await _db.config.update_one(
        {"_id": "updates"}, {"$set": cfg}, upsert=True,
    )


def _safe_sub(*args: str, timeout: int = 600) -> tuple[int, str]:
    """Run helper subprocess. Returns (rc, combined output, truncated to 4 KB)."""
    try:
        proc = subprocess.run(
            list(args), capture_output=True, text=True, timeout=timeout,
        )
        out = (proc.stdout or "") + (proc.stderr or "")
        return proc.returncode, out[-4096:]
    except subprocess.TimeoutExpired:
        return 124, "helper timed out"
    except FileNotFoundError:
        return 127, f"binary not found: {args[0]}"
    except Exception as e:  # noqa: BLE001
        return 1, f"{type(e).__name__}: {e}"


# ----- source probes -----
async def _probe_github(cfg: dict[str, Any]) -> dict[str, Any]:
    repo = cfg.get("github_repo") or ""
    if "/" not in repo:
        raise ValueError("github_repo must be 'owner/repo'")
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "flussonic-admin"}
    if cfg.get("github_token"):
        headers["Authorization"] = f"Bearer {cfg['github_token']}"
    url = f"https://api.github.com/repos/{repo}/releases/latest"
    async with httpx.AsyncClient(timeout=15.0) as c:
        r = await c.get(url, headers=headers)
        r.raise_for_status()
        data = r.json()
    version = (data.get("tag_name") or data.get("name") or "").lstrip("v").strip()
    notes = (data.get("body") or "")[:2000]
    asset_url = ""
    for asset in data.get("assets") or []:
        name = asset.get("name") or ""
        if name.endswith(".tar.gz") and "flussonic-admin" in name:
            asset_url = asset.get("browser_download_url") or ""
            break
    if not asset_url:
        asset_url = data.get("tarball_url") or ""
    return {"version": version, "url": asset_url, "notes": notes}


async def _probe_url(cfg: dict[str, Any]) -> dict[str, Any]:
    """If custom_url ends with /api/download/installer/info -> read JSON metadata.
    Else try to derive a version from the filename in Content-Disposition."""
    raw = (cfg.get("custom_url") or "").strip()
    if not raw:
        raise ValueError("custom_url is empty")
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as c:
        if raw.endswith("/info") or "/installer/info" in raw:
            r = await c.get(raw)
            r.raise_for_status()
            data = r.json()
            return {
                "version": data.get("version") or "",
                "url": data.get("download_url") or raw.rsplit("/info", 1)[0],
                "notes": "",
            }
        # Try HEAD to grab filename
        r = await c.head(raw)
        cd = r.headers.get("content-disposition", "")
        name = ""
        if "filename=" in cd:
            name = cd.split("filename=", 1)[1].strip().strip('"')
        if not name:
            name = raw.rstrip("/").rsplit("/", 1)[-1]
        version = name.replace("flussonic-admin-", "").replace(".tar.gz", "") if name else ""
        return {"version": version, "url": raw, "notes": ""}


async def _do_check(cfg: dict[str, Any]) -> dict[str, Any]:
    src = cfg.get("source_type") or "none"
    if src == "github":
        info = await _probe_github(cfg)
    elif src == "url":
        info = await _probe_url(cfg)
    else:
        raise ValueError(f"source_type '{src}' has no remote probe")
    cfg.update({
        "last_check": datetime.now(timezone.utc).isoformat(),
        "latest_available_version": info["version"],
        "latest_available_url": info["url"],
        "latest_available_notes": info["notes"],
        "last_error": "",
    })
    await _save_cfg(cfg)
    return cfg


async def _periodic_check_loop() -> None:
    # Wait a bit so the API is fully up first
    await asyncio.sleep(30)
    while True:
        try:
            cfg = await _load_cfg()
            if cfg["auto_check_enabled"] and cfg["source_type"] in ("github", "url"):
                try:
                    await _do_check(cfg)
                    logger.info("Auto-check OK → latest=%s", cfg.get("latest_available_version"))
                except Exception as e:  # noqa: BLE001
                    cfg["last_check"] = datetime.now(timezone.utc).isoformat()
                    cfg["last_error"] = f"{type(e).__name__}: {e}"
                    await _save_cfg(cfg)
                    logger.warning("Auto-check failed: %s", e)
            sleep_h = max(1, int(cfg.get("auto_check_hours", 6)))
        except Exception as e:  # noqa: BLE001
            logger.exception("update poller crashed: %s", e)
            sleep_h = 6
        await asyncio.sleep(sleep_h * 3600)


# ----- schemas -----
class UpdateConfigIn(BaseModel):
    source_type: str = "none"        # github | url | upload | none
    github_repo: str = ""
    github_token: str | None = None   # None = keep existing
    custom_url: str = ""
    auto_check_hours: int = 6
    auto_check_enabled: bool = True


class ApplyIn(BaseModel):
    mode: str = "quick"               # quick | full
    filename: str                      # tarball already in SPOOL_DIR
    download_url: str | None = None    # if not yet downloaded, fetch it first


# ----- router factory (so server.py can pass require_admin) -----
def build_router(require_admin) -> APIRouter:
    r = APIRouter(prefix="/updates")

    @r.get("/status")
    async def status(_=Depends(require_admin)):
        cfg = await _load_cfg()
        # Mask the token in responses
        token_masked = bool(cfg.get("github_token"))
        cfg_view = {**cfg, "github_token": "" if not token_masked else "***"}
        cur = current_version()
        latest = cfg.get("latest_available_version") or ""
        update_available = bool(latest) and latest != cur
        # Spooled (uploaded) tarballs awaiting apply
        spool: list[dict[str, Any]] = []
        if SPOOL_DIR.exists():
            for p in sorted(SPOOL_DIR.glob("flussonic-admin-*.tar.gz"), key=lambda x: x.stat().st_mtime, reverse=True):
                spool.append({
                    "filename": p.name,
                    "size_bytes": p.stat().st_size,
                    "mtime": datetime.fromtimestamp(p.stat().st_mtime, tz=timezone.utc).isoformat(),
                    "version": p.name.replace("flussonic-admin-", "").replace(".tar.gz", ""),
                })
        has_backup = (Path("/opt/flussonic-admin.bak")).exists()
        return {
            "current_version": cur,
            "update_available": update_available,
            "helper_available": _is_helper_available(),
            "spool": spool,
            "has_backup": has_backup,
            **cfg_view,
        }

    @r.put("/config")
    async def set_config(body: UpdateConfigIn, _=Depends(require_admin)):
        cfg = await _load_cfg()
        cfg["source_type"] = body.source_type
        cfg["github_repo"] = body.github_repo.strip()
        if body.github_token is not None:
            cfg["github_token"] = body.github_token.strip()
        cfg["custom_url"] = body.custom_url.strip()
        cfg["auto_check_hours"] = max(1, int(body.auto_check_hours))
        cfg["auto_check_enabled"] = bool(body.auto_check_enabled)
        await _save_cfg(cfg)
        # Mask in response
        cfg["github_token"] = "***" if cfg.get("github_token") else ""
        return cfg

    @r.post("/check")
    async def check_now(_=Depends(require_admin)):
        cfg = await _load_cfg()
        if cfg["source_type"] not in ("github", "url"):
            raise HTTPException(status_code=400, detail="Configure a remote source (github/url) first")
        try:
            cfg = await _do_check(cfg)
        except Exception as e:  # noqa: BLE001
            cfg["last_check"] = datetime.now(timezone.utc).isoformat()
            cfg["last_error"] = f"{type(e).__name__}: {e}"
            await _save_cfg(cfg)
            raise HTTPException(status_code=502, detail=cfg["last_error"]) from e
        cfg["github_token"] = "***" if cfg.get("github_token") else ""
        return cfg

    @r.post("/upload")
    async def upload(file: UploadFile = File(...), _=Depends(require_admin)):
        if not (file.filename or "").endswith(".tar.gz"):
            raise HTTPException(status_code=400, detail="Only .tar.gz tarballs are allowed")
        SPOOL_DIR.mkdir(parents=True, exist_ok=True)
        safe = Path(file.filename).name.replace("/", "_")
        dest = SPOOL_DIR / safe
        # Stream to disk in chunks to support large bundles
        sha = hashlib.sha256()
        size = 0
        with open(dest, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                sha.update(chunk)
                size += len(chunk)
                out.write(chunk)
        return {"filename": safe, "size_bytes": size, "sha256": sha.hexdigest()}

    @r.post("/apply")
    async def apply(body: ApplyIn, _=Depends(require_admin)):
        if body.mode not in ("quick", "full"):
            raise HTTPException(status_code=400, detail="mode must be quick|full")
        SPOOL_DIR.mkdir(parents=True, exist_ok=True)

        # Resolve the actual tarball path
        tarball = SPOOL_DIR / Path(body.filename).name
        if not tarball.exists() and body.download_url:
            # Download from the configured remote source
            async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as c:
                async with c.stream("GET", body.download_url) as resp:
                    resp.raise_for_status()
                    with open(tarball, "wb") as f:
                        async for chunk in resp.aiter_bytes(1024 * 1024):
                            f.write(chunk)
        if not tarball.exists():
            raise HTTPException(status_code=404, detail=f"tarball not found in spool: {tarball.name}")

        if not _is_helper_available():
            raise HTTPException(status_code=503, detail=(
                "Update helper not installed. Re-run install/install.sh on the VPS "
                "to provision /usr/local/bin/flussonic-admin-update + sudoers."
            ))

        # Helper requires root → invoked via sudo (NOPASSWD allowed by /etc/sudoers.d/flussonic-admin)
        rc, out = _safe_sub("sudo", "-n", UPDATE_HELPER, body.mode, str(tarball), timeout=1200)
        if rc != 0:
            raise HTTPException(status_code=500, detail=f"Update failed (rc={rc}):\n{out}")
        return {"ok": True, "mode": body.mode, "tarball": tarball.name, "output": out, "new_version": current_version()}

    @r.post("/rollback")
    async def rollback(_=Depends(require_admin)):
        if not _is_helper_available():
            raise HTTPException(status_code=503, detail="Update helper not installed")
        rc, out = _safe_sub("sudo", "-n", UPDATE_HELPER, "rollback", timeout=300)
        if rc != 0:
            raise HTTPException(status_code=500, detail=f"Rollback failed (rc={rc}):\n{out}")
        return {"ok": True, "output": out, "new_version": current_version()}

    return r


def init(db, *, start_loop: bool = True):
    """Wire the module to the Mongo handle and start the background poller."""
    global _db, _check_task
    _db = db
    if start_loop and _check_task is None:
        try:
            _check_task = asyncio.get_event_loop().create_task(_periodic_check_loop())
        except RuntimeError:
            # No loop yet — caller will start it later
            _check_task = None
