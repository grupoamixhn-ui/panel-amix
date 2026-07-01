"""Self-hosted installer download endpoints.

Exposes the bundled installer tarball so a fresh VPS can fetch + run it via
a single curl one-liner. The tarball is built on-demand from
`install/make-release.sh` and cached in `/dist/`.

GET endpoints are intentionally PUBLIC (no auth) so the curl one-liner works
on a fresh server without juggling tokens.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import subprocess
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse

from deps import get_current_user

router = APIRouter()
logger = logging.getLogger("amixpanel.download")

ROOT_DIR = Path(__file__).resolve().parent.parent  # /app/backend
INSTALL_DIR = ROOT_DIR.parent / "install"
DIST_DIR = ROOT_DIR.parent / "dist"
_release_build_lock = asyncio.Lock()


async def _ensure_release_built() -> Path | None:
    """Return the newest tarball in dist/, building one on the fly if missing."""
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    candidates = sorted(DIST_DIR.glob("amixpanel-*.tar.gz"),
                        key=lambda p: p.stat().st_mtime, reverse=True)
    if candidates:
        return candidates[0]
    script = INSTALL_DIR / "make-release.sh"
    if not script.is_file():
        return None
    async with _release_build_lock:
        candidates = sorted(DIST_DIR.glob("amixpanel-*.tar.gz"),
                            key=lambda p: p.stat().st_mtime, reverse=True)
        if candidates:
            return candidates[0]
        proc = await asyncio.create_subprocess_exec(
            "bash", str(script), "--out", str(DIST_DIR),
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        )
        out, _ = await proc.communicate()
        if proc.returncode != 0:
            logger.error("make-release.sh failed (%s): %s",
                         proc.returncode, out.decode(errors="replace")[-500:])
            return None
    candidates = sorted(DIST_DIR.glob("amixpanel-*.tar.gz"),
                        key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0] if candidates else None


@router.get("/download/installer/info")
async def download_installer_info(request: Request):
    """Public metadata about the latest release tarball + curl one-liner."""
    tarball = await _ensure_release_built()
    if not tarball:
        raise HTTPException(status_code=503,
                            detail="Release tarball not available — make-release.sh missing or failed")
    data = tarball.read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    fwd_proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    fwd_host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    public_url = f"{fwd_proto}://{fwd_host}/api/download/installer"
    inner_dir = tarball.name[:-len(".tar.gz")]
    return {
        "filename": tarball.name,
        "version": inner_dir.replace("amixpanel-", ""),
        "size_bytes": len(data),
        "sha256": sha,
        "download_url": public_url,
        "curl_oneliner": (
            f"curl -fsSL '{public_url}' -o /tmp/{tarball.name} && "
            f"cd /tmp && tar xzf {tarball.name} && cd {inner_dir} && "
            f"sudo bash install/install.sh"
        ),
    }


@router.get("/download/installer", name="download_installer")
async def download_installer():
    """Serve the latest release tarball as a file download (no auth)."""
    tarball = await _ensure_release_built()
    if not tarball:
        raise HTTPException(status_code=503, detail="Release tarball not available")
    return FileResponse(
        path=tarball,
        media_type="application/gzip",
        filename=tarball.name,
    )


@router.post("/download/installer/rebuild")
async def rebuild_installer(user=Depends(get_current_user)):
    """Force-rebuild the tarball (admin-only)."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    for old in DIST_DIR.glob("amixpanel-*.tar.gz"):
        try:
            old.unlink()
        except OSError:
            pass
    tarball = await _ensure_release_built()
    if not tarball:
        raise HTTPException(status_code=500, detail="Rebuild failed — check backend logs")
    return {"ok": True, "filename": tarball.name, "size_bytes": tarball.stat().st_size}
