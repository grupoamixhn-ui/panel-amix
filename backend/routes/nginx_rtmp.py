"""nginx-rtmp encoder receiver endpoints — used by the Settings UI."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from deps import require_admin
from services import nginx_rtmp

router = APIRouter(prefix="/nginx-rtmp", tags=["nginx-rtmp"])


class InstallIn(BaseModel):
    port: int = 1935
    app: str = "live"


class UrlsIn(BaseModel):
    port: int = 1935
    app: str = "live"
    stream_key: str = "mystream"


@router.get("/status")
async def status(_=Depends(require_admin)):
    return await nginx_rtmp.status()


@router.post("/install")
async def install(body: InstallIn, _=Depends(require_admin)):
    return await nginx_rtmp.install(port=body.port, app=body.app)


@router.get("/log")
async def log_tail(lines: int = 200, _=Depends(require_admin)):
    return {"log": await nginx_rtmp.tail_log(lines)}


@router.post("/urls")
async def urls(body: UrlsIn, _=Depends(require_admin)):
    return await nginx_rtmp.connection_urls(body.port, body.app, body.stream_key)
