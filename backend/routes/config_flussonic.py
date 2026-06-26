"""Flussonic connection configuration endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

import flussonic
from deps import get_current_user
from models import FlussonicConfigIn, FlussonicTestIn

router = APIRouter()


@router.get("/config/flussonic")
async def config_get(user=Depends(get_current_user)):
    return await flussonic.get_public_config()


@router.put("/config/flussonic")
async def config_put(body: FlussonicConfigIn, user=Depends(get_current_user)):
    await flussonic.save_config(
        url=body.url, user=body.user, password=body.password,
        api_path=body.api_path,
        public_host=body.public_host, srt_port=body.srt_port,
        srt_publish_port=body.srt_publish_port,
        srt_play_port=body.srt_play_port,
        rtmp_port=body.rtmp_port, https=body.https,
    )
    return await flussonic.get_public_config()


@router.get("/config/flussonic/detect-ports")
async def config_detect_ports(user=Depends(get_current_user)):
    """Auto-detect SRT / RTMP ports from the live Flussonic /config endpoint."""
    return await flussonic.detect_flussonic_ports()


@router.get("/config/flussonic/raw")
async def config_flussonic_raw(user=Depends(get_current_user)):
    """Admin-only — dump raw /config JSON so we can see which keys this build exposes."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return await flussonic.fetch_raw_flussonic_config()


@router.post("/config/flussonic/test")
async def config_test(body: FlussonicTestIn, user=Depends(get_current_user)):
    pwd = body.password
    if not pwd:
        cur = await flussonic._active_config()  # noqa: SLF001
        if body.url.rstrip("/") == cur["url"].rstrip("/") and body.user == cur.get("user", ""):
            pwd = cur.get("password", "")
    return await flussonic.test_connection(
        url=body.url, user=body.user, password=pwd or "", api_path=body.api_path or None,
    )


@router.post("/config/flussonic/clear")
async def config_clear(user=Depends(get_current_user)):
    await flussonic.clear_config()
    return await flussonic.get_public_config()
