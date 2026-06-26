"""Server info + hardware + sessions + stats + monitor metrics endpoints."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends

import flussonic
from deps import get_current_user
from scope import effective_streams

router = APIRouter()


@router.get("/server/info")
async def server_info(user=Depends(get_current_user)):
    info = await flussonic.get_server_info()
    pool = await effective_streams(user)
    if pool is None:
        return info
    # Non-admin: scope KPIs to allowed streams only
    streams = await flussonic.list_streams()
    pool_set = set(pool)
    scoped = [s for s in streams if s.get("name") in pool_set]
    info["streams_total"] = len(scoped)
    info["streams_live"] = sum(1 for s in scoped if s.get("alive"))
    info["clients"] = sum(int(s.get("clients") or 0) for s in scoped)
    info["bandwidth_bps"] = sum(int(s.get("bitrate") or 0) for s in scoped)
    return info


@router.get("/server/hardware")
async def server_hardware(user=Depends(get_current_user)):
    """Hardware + runtime info (panel host + Flussonic version)."""
    return await flussonic.get_server_hardware()


@router.get("/streams/{name}/sessions")
async def streams_sessions(name: str, user=Depends(get_current_user)):
    return await flussonic.list_sessions_for_stream(name)


@router.get("/sessions")
async def sessions_list(user=Depends(get_current_user)):
    sessions = await flussonic.list_sessions()
    pool = await effective_streams(user)
    if pool is None:
        return sessions
    pool_set = set(pool)
    return [s for s in sessions if s.get("stream") in pool_set]


@router.get("/stats")
async def stats(points: int = 30, user=Depends(get_current_user)):
    pool = await effective_streams(user)
    if pool is None:
        return await flussonic.get_stats_timeseries(points)
    # Non-admin: build series from scoped streams only
    streams = await flussonic.list_streams()
    pool_set = set(pool)
    scoped = [s for s in streams if s.get("name") in pool_set]
    clients = sum(int(s.get("clients") or 0) for s in scoped)
    bandwidth = sum(int(s.get("bitrate") or 0) for s in scoped)
    now = datetime.now(timezone.utc)
    series = [{
        "ts": (now - timedelta(minutes=i)).isoformat(),
        "clients": clients,
        "bandwidth": bandwidth,
    } for i in range(points, 0, -1)]
    return {"series": series}


@router.get("/monitor/metrics")
async def monitor_metrics(user=Depends(get_current_user)):
    return await flussonic.get_monitor_metrics()
