"""Flussonic server-wide limits endpoints (max_sessions, client_timeout, cache)."""
from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import flussonic
from deps import get_current_user

router = APIRouter()


class ServerLimitsIn(BaseModel):
    max_sessions: int | None = None
    cache_path: str | None = None
    cache_size: str | None = None
    client_timeout: int | None = None


@router.get("/server/limits")
async def server_limits_get(user=Depends(get_current_user)):
    return await flussonic.get_server_limits()


@router.put("/server/limits")
async def server_limits_put(body: ServerLimitsIn, user=Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    try:
        return await flussonic.set_server_limits(
            max_sessions=body.max_sessions,
            cache_path=body.cache_path,
            cache_size=body.cache_size,
            client_timeout=body.client_timeout,
        )
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Flussonic rejected the update ({e.response.status_code})",
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e))
