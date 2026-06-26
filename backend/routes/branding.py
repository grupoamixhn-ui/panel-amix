"""Branding (logo, favicon, brand name, theme colors) endpoints."""
from __future__ import annotations

import base64
import re

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

import flussonic
from deps import get_current_user

router = APIRouter()

_LOGO_MAX_BYTES = 1_000_000  # 1MB
_LOGO_MIME = {"image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp", "image/gif"}
_FAVICON_MAX_BYTES = 300_000  # 300 KB
_FAVICON_MIME = {"image/png", "image/x-icon", "image/vnd.microsoft.icon",
                 "image/svg+xml", "image/jpeg", "image/webp"}
_HEX_COLOR_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")


def _validate_color(value: str | None, field: str) -> str | None:
    if value is None or value == "":
        return value  # None = unchanged, "" = clear
    if not _HEX_COLOR_RE.match(value):
        raise HTTPException(status_code=400, detail=f"{field} must be a hex color like #2563EB")
    return value


@router.get("/branding")
async def branding_get():
    """Public — no auth so the login page can render the logo."""
    return await flussonic.get_branding()


@router.post("/branding")
async def branding_post(
    logo: UploadFile | None = File(default=None),
    favicon: UploadFile | None = File(default=None),
    brand_name: str | None = Form(default=None),
    tagline: str | None = Form(default=None),
    primary_color: str | None = Form(default=None),
    primary_hover: str | None = Form(default=None),
    primary_soft: str | None = Form(default=None),
    user=Depends(get_current_user),
):
    data_uri: str | None = None
    if logo is not None:
        if logo.content_type not in _LOGO_MIME:
            raise HTTPException(status_code=400, detail=f"Unsupported logo type: {logo.content_type}")
        blob = await logo.read()
        if len(blob) > _LOGO_MAX_BYTES:
            raise HTTPException(status_code=413, detail="Logo file too large (max 1MB)")
        data_uri = f"data:{logo.content_type};base64,{base64.b64encode(blob).decode()}"

    favicon_uri: str | None = None
    if favicon is not None:
        if favicon.content_type not in _FAVICON_MIME:
            raise HTTPException(status_code=400, detail=f"Unsupported favicon type: {favicon.content_type}")
        fblob = await favicon.read()
        if len(fblob) > _FAVICON_MAX_BYTES:
            raise HTTPException(status_code=413, detail="Favicon file too large (max 300KB)")
        favicon_uri = f"data:{favicon.content_type};base64,{base64.b64encode(fblob).decode()}"

    return await flussonic.save_branding(
        logo_data_uri=data_uri,
        favicon_data_uri=favicon_uri,
        brand_name=brand_name,
        tagline=tagline,
        primary_color=_validate_color(primary_color, "primary_color"),
        primary_hover=_validate_color(primary_hover, "primary_hover"),
        primary_soft=_validate_color(primary_soft, "primary_soft"),
    )


@router.delete("/branding/logo")
async def branding_logo_clear(user=Depends(get_current_user)):
    return await flussonic.clear_branding_logo()


@router.delete("/branding/favicon")
async def branding_favicon_clear(user=Depends(get_current_user)):
    return await flussonic.clear_branding_favicon()
