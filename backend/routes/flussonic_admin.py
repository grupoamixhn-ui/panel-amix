"""Endpoints to install Flussonic Media Server on the host + manage its license."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from deps import require_admin
from services import flussonic_setup

router = APIRouter()


class InstallIn(BaseModel):
    license_key: str = Field(default="", max_length=256)


class LicenseIn(BaseModel):
    license_key: str = Field(min_length=8, max_length=256)


@router.get("/flussonic/detect")
async def flussonic_detect(user=Depends(require_admin)):
    """Check if Flussonic is already installed/running on the panel host."""
    return await flussonic_setup.detect_flussonic_running()


@router.post("/flussonic/install")
async def flussonic_install(body: InstallIn, user=Depends(require_admin)):
    """Trigger the official Flussonic installer in the background."""
    return await flussonic_setup.start_install(license_key=body.license_key)


@router.get("/flussonic/install/status")
async def flussonic_install_status(user=Depends(require_admin)):
    """Poll the installer status + live log tail (last 32 KB)."""
    return await flussonic_setup.get_install_status()


@router.get("/flussonic/license")
async def flussonic_license_get(user=Depends(require_admin)):
    """Get current license status (masked key + Flussonic-reported edition/expiry)."""
    return await flussonic_setup.get_license_status()


@router.put("/flussonic/license")
async def flussonic_license_put(body: LicenseIn, user=Depends(require_admin)):
    """Save the license key and push it to Flussonic (triggers a hot reload)."""
    try:
        return await flussonic_setup.set_license_key(body.license_key)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
