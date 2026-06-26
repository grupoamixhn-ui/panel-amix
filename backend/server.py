from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import logging
from datetime import datetime, timezone
from typing import Any

import httpx
from bson import ObjectId
from bson.errors import InvalidId
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends
from pydantic import BaseModel, EmailStr, Field
from starlette.middleware.cors import CORSMiddleware

import flussonic
import updates as updates_module
from deps import (
    db,
    mongo_client,
    get_current_user,
    require_admin,
    require_admin_or_reseller,
    hash_password,
    verify_password,
    create_access_token,
)
from routes import ssl as ssl_routes
from routes import branding as branding_routes
from routes import download as download_routes
from routes import server_limits as server_limits_routes

# ---------- Setup ----------
app = FastAPI(title="Flussonic Admin API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("flussonic-admin")


# ---------- Role / scope helpers ----------
async def get_descendant_ids(root_id: str) -> set[str]:
    """All user IDs in the sub-tree rooted at ``root_id`` (excludes the root itself)."""
    found: set[str] = set()
    frontier: list[str] = [root_id]
    while frontier:
        cursor = db.users.find({"parent_id": {"$in": frontier}}, {"_id": 1})
        next_layer: list[str] = []
        async for doc in cursor:
            sid = str(doc["_id"])
            if sid in found:
                continue
            found.add(sid)
            next_layer.append(sid)
        frontier = next_layer
    return found


async def in_my_scope(actor: dict, target_id: str) -> bool:
    if actor["role"] == "admin":
        return True
    if actor["id"] == target_id:
        return True
    descendants = await get_descendant_ids(actor["id"])
    return target_id in descendants


async def effective_streams(user: dict) -> list[str] | None:
    """Return the list of stream names this user is allowed to see, or None for 'all'."""
    if user.get("role") == "admin":
        return None
    pool = user.get("streams_allowed")
    return list(pool) if isinstance(pool, list) else []


# ---------- Schemas ----------
class LoginIn(BaseModel):
    email: EmailStr
    password: str

class StreamIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    url: str = Field(min_length=1)
    title: str = ""
    publish_password: str | None = None
    max_bitrate_kbps: int | None = None     # 0 / null = unlimited
    source_timeout: int | None = None        # seconds (default 60 on Flussonic)
    max_sessions: int | None = None          # per-stream concurrent viewer cap (0 = unlimited)

class StreamUpdateIn(BaseModel):
    url: str | None = None
    title: str | None = None
    publish_password: str | None = None
    max_bitrate_kbps: int | None = None
    source_timeout: int | None = None
    max_sessions: int | None = None

class ToggleIn(BaseModel):
    start: bool


class FlussonicConfigIn(BaseModel):
    url: str = ""
    user: str = ""
    password: str | None = None  # None = keep existing
    api_path: str | None = None
    public_host: str | None = None
    srt_port: int | None = None
    srt_publish_port: int | None = None
    srt_play_port: int | None = None
    rtmp_port: int | None = None
    https: bool | None = None


class FlussonicTestIn(BaseModel):
    url: str
    user: str = ""
    password: str = ""
    api_path: str | None = None


# ---------- Auth endpoints ----------
@api.post("/auth/login")
async def login(body: LoginIn, response: Response):
    email = body.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(str(user["_id"]), email)
    response.set_cookie(
        key="access_token", value=token, httponly=True, secure=False,
        samesite="lax", max_age=43200, path="/",
    )
    return {
        "id": str(user["_id"]),
        "email": user["email"],
        "name": user.get("name", "Admin"),
        "role": user.get("role", "admin"),
        "token": token,
    }

@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}

@api.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return user


# ---------- Sub-users (resellers / clients) ----------
class SubUserIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=4, max_length=80)
    role: str  # "reseller" | "client"
    name: str = ""
    streams_allowed: list[str] = []
    max_streams: int | None = None
    max_sub_users: int | None = None
    max_concurrent_viewers: int | None = None
    expires_at: str | None = None  # ISO 8601
    notes: str = ""


class SubUserUpdateIn(BaseModel):
    password: str | None = None
    name: str | None = None
    streams_allowed: list[str] | None = None
    max_streams: int | None = None
    max_sub_users: int | None = None
    max_concurrent_viewers: int | None = None
    expires_at: str | None = None
    notes: str | None = None
    active: bool | None = None


def _serialize_user(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "email": doc["email"],
        "name": doc.get("name", ""),
        "role": doc.get("role", "client"),
        "parent_id": str(doc["parent_id"]) if doc.get("parent_id") else None,
        "streams_allowed": doc.get("streams_allowed", []),
        "max_streams": doc.get("max_streams"),
        "max_sub_users": doc.get("max_sub_users"),
        "max_concurrent_viewers": doc.get("max_concurrent_viewers"),
        "expires_at": doc.get("expires_at"),
        "active": doc.get("active", True),
        "notes": doc.get("notes", ""),
        "created_at": doc.get("created_at"),
    }


def _validate_subset(child: list[str], parent_pool: list[str] | None) -> list[str]:
    """Ensure child streams are a subset of parent. None parent_pool means 'all allowed'."""
    if parent_pool is None:
        return list(child or [])
    return [s for s in (child or []) if s in parent_pool]


@api.get("/sub-users")
async def sub_users_list(user=Depends(require_admin_or_reseller)):
    if user["role"] == "admin":
        # Show all non-self admin/reseller/client accounts
        cursor = db.users.find({
            "role": {"$in": ["admin", "reseller", "client"]},
            "_id": {"$ne": ObjectId(user["id"])},
        })
    else:
        descendant_ids = await get_descendant_ids(user["id"])
        if not descendant_ids:
            return []
        cursor = db.users.find({"_id": {"$in": [ObjectId(i) for i in descendant_ids]}})
    return [_serialize_user(d) async for d in cursor.sort("created_at", -1)]


@api.post("/sub-users")
async def sub_users_create(body: SubUserIn, user=Depends(require_admin_or_reseller)):
    # Only admins can create other admins; resellers can only create reseller/client
    if user["role"] == "reseller" and body.role not in ("reseller", "client"):
        raise HTTPException(status_code=403, detail="Resellers can only create resellers or clients")
    if body.role not in ("admin", "reseller", "client"):
        raise HTTPException(status_code=400, detail="role must be 'admin', 'reseller' or 'client'")
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email already exists")
    if user["role"] == "reseller":
        # Subset enforcement
        parent_pool = user.get("streams_allowed") if user["role"] != "admin" else None
        body.streams_allowed = _validate_subset(body.streams_allowed, parent_pool)
        # Limit enforcement: max_sub_users
        cap = user.get("max_sub_users")
        if isinstance(cap, int) and cap > 0:
            descendants = await get_descendant_ids(user["id"])
            if len(descendants) >= cap:
                raise HTTPException(status_code=403, detail=f"Sub-user quota reached ({cap})")
        # Cannot create stream/sub limits higher than your own
        for k in ("max_streams", "max_sub_users", "max_concurrent_viewers"):
            v = getattr(body, k)
            my_v = user.get(k)
            if isinstance(my_v, int) and isinstance(v, int) and v > my_v:
                setattr(body, k, my_v)
    doc = {
        "email": email,
        "password_hash": hash_password(body.password),
        "role": body.role,
        "name": body.name or email.split("@")[0],
        "parent_id": ObjectId(user["id"]) if user["role"] != "admin" else (ObjectId(user["id"]) if user.get("id") else None),
        "streams_allowed": list(body.streams_allowed or []),
        "max_streams": body.max_streams,
        "max_sub_users": body.max_sub_users,
        "max_concurrent_viewers": body.max_concurrent_viewers,
        "expires_at": body.expires_at,
        "notes": body.notes,
        "active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": ObjectId(user["id"]) if user.get("id") else None,
    }
    res = await db.users.insert_one(doc)
    doc["_id"] = res.inserted_id
    return _serialize_user(doc)


@api.put("/sub-users/{uid}")
async def sub_users_update(uid: str, body: SubUserUpdateIn, user=Depends(require_admin_or_reseller)):
    try:
        target_oid = ObjectId(uid)
    except InvalidId:
        raise HTTPException(status_code=404, detail="Not found")
    target = await db.users.find_one({"_id": target_oid})
    if not target:
        raise HTTPException(status_code=404, detail="Not found")
    if not await in_my_scope(user, uid):
        raise HTTPException(status_code=403, detail="Forbidden")
    if target.get("role") == "admin":
        raise HTTPException(status_code=403, detail="Cannot modify admin")
    update: dict[str, Any] = {}
    if body.password:
        update["password_hash"] = hash_password(body.password)
    if body.name is not None:
        update["name"] = body.name
    if body.streams_allowed is not None:
        parent_pool = user.get("streams_allowed") if user["role"] != "admin" else None
        update["streams_allowed"] = _validate_subset(body.streams_allowed, parent_pool)
    for k in ("max_streams", "max_sub_users", "max_concurrent_viewers"):
        v = getattr(body, k)
        if v is not None:
            update[k] = v
    if body.expires_at is not None:
        update["expires_at"] = body.expires_at
    if body.notes is not None:
        update["notes"] = body.notes
    if body.active is not None:
        update["active"] = bool(body.active)
    if not update:
        return _serialize_user(target)
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.users.update_one({"_id": target_oid}, {"$set": update})
    refreshed = await db.users.find_one({"_id": target_oid})
    return _serialize_user(refreshed)


@api.delete("/sub-users/{uid}")
async def sub_users_delete(uid: str, user=Depends(require_admin_or_reseller)):
    try:
        target_oid = ObjectId(uid)
    except InvalidId:
        raise HTTPException(status_code=404, detail="Not found")
    target = await db.users.find_one({"_id": target_oid})
    if not target:
        raise HTTPException(status_code=404, detail="Not found")
    if not await in_my_scope(user, uid):
        raise HTTPException(status_code=403, detail="Forbidden")
    if target_oid == ObjectId(user["id"]):
        raise HTTPException(status_code=403, detail="Cannot delete yourself")
    if target.get("role") == "admin" and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only admins can delete admin users")
    # Safety: don't allow deleting the last admin
    if target.get("role") == "admin":
        remaining = await db.users.count_documents({"role": "admin", "_id": {"$ne": target_oid}})
        if remaining == 0:
            raise HTTPException(status_code=403, detail="Cannot delete the last admin user")
    # Cascade: delete the whole sub-tree
    descendants = await get_descendant_ids(uid)
    descendants.add(uid)
    await db.users.delete_many({"_id": {"$in": [ObjectId(i) for i in descendants]}})
    return {"ok": True, "deleted": len(descendants)}


# ---------- Flussonic endpoints ----------
@api.get("/server/info")
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


@api.get("/server/hardware")
async def server_hardware(user=Depends(get_current_user)):
    """Hardware + runtime info (panel host + Flussonic version)."""
    return await flussonic.get_server_hardware()

@api.get("/streams")
async def streams_list(user=Depends(get_current_user)):
    streams = await flussonic.list_streams()
    pool = await effective_streams(user)
    if pool is None:
        return streams
    pool_set = set(pool)
    return [s for s in streams if s.get("name") in pool_set]

@api.post("/streams")
async def streams_create(body: StreamIn, user=Depends(get_current_user)):
    try:
        return await flussonic.create_stream(
            body.name, body.url, body.title, body.publish_password,
            max_bitrate_kbps=body.max_bitrate_kbps,
            source_timeout=body.source_timeout,
            max_sessions=body.max_sessions,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

@api.get("/streams/{name}")
async def streams_get(name: str, user=Depends(get_current_user)):
    pool = await effective_streams(user)
    if pool is not None and name not in pool:
        raise HTTPException(status_code=403, detail="Forbidden")
    s = await flussonic.get_stream(name)
    if not s:
        raise HTTPException(status_code=404, detail="Stream not found")
    return s

@api.get("/streams/{name}/raw")
async def streams_get_raw(name: str, user=Depends(get_current_user)):
    """Admin-only debug endpoint — returns the unmodified Flussonic payload so we
    can see exactly which fields a particular server version exposes for a stream."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    cfg = await flussonic._active_config()
    async with flussonic._make_client(cfg) as c:
        for path in (f"/streamer/api/v3/streams/{name}", f"/flussonic/api/v3/streams/{name}"):
            try:
                r = await c.get(path)
                if r.status_code == 200:
                    return {"path": path, "data": r.json()}
            except Exception:  # noqa: BLE001
                continue
    raise HTTPException(status_code=502, detail="Flussonic did not return raw stream data")


@api.put("/streams/{name}")
async def streams_update(name: str, body: StreamUpdateIn, user=Depends(get_current_user)):
    s = await flussonic.update_stream(name, body.model_dump(exclude_none=True))
    if not s:
        raise HTTPException(status_code=404, detail="Stream not found")
    return s

@api.delete("/streams/{name}")
async def streams_delete(name: str, user=Depends(get_current_user)):
    ok = await flussonic.delete_stream(name)
    if not ok:
        raise HTTPException(status_code=404, detail="Stream not found")
    return {"ok": True}

@api.post("/streams/{name}/toggle")
async def streams_toggle(name: str, body: ToggleIn, user=Depends(get_current_user)):
    s = await flussonic.toggle_stream(name, body.start)
    if not s:
        raise HTTPException(status_code=404, detail="Stream not found")
    return s


@api.post("/streams/{name}/reset")
async def streams_reset(name: str, user=Depends(get_current_user)):
    pool = await effective_streams(user)
    if pool is not None and name not in pool:
        raise HTTPException(status_code=403, detail="Forbidden")
    s = await flussonic.reset_stream(name)
    if not s:
        raise HTTPException(status_code=404, detail="Stream not found")
    return s


@api.get("/streams/{name}/outputs")
async def streams_outputs(name: str, user=Depends(get_current_user)):
    return await flussonic.stream_outputs(name)


@api.get("/streams/{name}/live-stats")
async def streams_live_stats(name: str, user=Depends(get_current_user)):
    pool = await effective_streams(user)
    if pool is not None and name not in pool:
        raise HTTPException(status_code=403, detail="Forbidden")
    data = await flussonic.get_stream_live_stats(name)
    if not data:
        raise HTTPException(status_code=404, detail="Stream not found")
    return data

# ---------- Stream push targets (YouTube/Facebook/TikTok/Instagram/Custom RTMP) ----------
class StreamPushIn(BaseModel):
    url: str
    label: str = ""


@api.get("/pushes")
async def all_pushes_list(user=Depends(get_current_user)):
    """List push targets across every stream the user can access."""
    pool = await effective_streams(user)
    streams = await flussonic.list_streams()
    if pool is not None:
        pool_set = set(pool)
        streams = [s for s in streams if s.get("name") in pool_set]
    out: list[dict[str, Any]] = []
    for s in streams:
        name = s.get("name")
        if not name:
            continue
        try:
            entries = await flussonic.list_stream_pushes(name)
        except Exception:  # noqa: BLE001
            entries = []
        for p in entries or []:
            out.append({
                "stream": name,
                "stream_title": s.get("title", ""),
                "stream_alive": bool(s.get("alive")),
                **p,
            })
    return out


@api.get("/streams/{name}/pushes")
async def stream_pushes_list(name: str, user=Depends(get_current_user)):
    pool = await effective_streams(user)
    if pool is not None and name not in pool:
        raise HTTPException(status_code=403, detail="Forbidden")
    try:
        return await flussonic.list_stream_pushes(name)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Flussonic returned {e.response.status_code}")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e))


@api.post("/streams/{name}/pushes")
async def stream_push_add(name: str, body: StreamPushIn, user=Depends(get_current_user)):
    # Clients may manage pushes only on their assigned streams; resellers / admins on everything in scope
    pool = await effective_streams(user)
    if pool is not None and name not in pool:
        raise HTTPException(status_code=403, detail="Forbidden")
    if not body.url:
        raise HTTPException(status_code=400, detail="url is required")
    try:
        return await flussonic.add_stream_push(name, body.url, body.label)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Flussonic rejected the push ({e.response.status_code})")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e))


@api.delete("/streams/{name}/pushes")
async def stream_push_remove(name: str, url: str, user=Depends(get_current_user)):
    pool = await effective_streams(user)
    if pool is not None and name not in pool:
        raise HTTPException(status_code=403, detail="Forbidden")
    if not url:
        raise HTTPException(status_code=400, detail="url query param is required")
    try:
        return await flussonic.remove_stream_push(name, url)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Flussonic rejected the request ({e.response.status_code})")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e))


@api.get("/streams/{name}/sessions")
async def streams_sessions(name: str, user=Depends(get_current_user)):
    return await flussonic.list_sessions_for_stream(name)

@api.get("/sessions")
async def sessions_list_v2(user=Depends(get_current_user)):
    sessions = await flussonic.list_sessions()
    pool = await effective_streams(user)
    if pool is None:
        return sessions
    pool_set = set(pool)
    return [s for s in sessions if s.get("stream") in pool_set]

@api.get("/stats")
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
    from datetime import datetime as _dt, timedelta as _td, timezone as _tz
    now = _dt.now(_tz.utc)
    series = [{
        "ts": (now - _td(minutes=i)).isoformat(),
        "clients": clients,
        "bandwidth": bandwidth,
    } for i in range(points, 0, -1)]
    return {"series": series}


@api.get("/monitor/metrics")
async def monitor_metrics(user=Depends(get_current_user)):
    return await flussonic.get_monitor_metrics()


# ---------- Flussonic connection config ----------
@api.get("/config/flussonic")
async def config_get(user=Depends(get_current_user)):
    return await flussonic.get_public_config()


@api.put("/config/flussonic")
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


@api.get("/config/flussonic/detect-ports")
async def config_detect_ports(user=Depends(get_current_user)):
    """Auto-detect SRT / RTMP ports from the live Flussonic /config endpoint."""
    return await flussonic.detect_flussonic_ports()


@api.get("/config/flussonic/raw")
async def config_flussonic_raw(user=Depends(get_current_user)):
    """Admin-only — dump the raw /config JSON so we can see exactly which keys
    your Flussonic version exposes (useful when port auto-detection misses them)."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return await flussonic.fetch_raw_flussonic_config()


@api.post("/config/flussonic/test")
async def config_test(body: FlussonicTestIn, user=Depends(get_current_user)):
    pwd = body.password
    if not pwd:
        cur = await flussonic._active_config()  # noqa: SLF001
        if body.url.rstrip("/") == cur["url"].rstrip("/") and body.user == cur.get("user", ""):
            pwd = cur.get("password", "")
    return await flussonic.test_connection(
        url=body.url, user=body.user, password=pwd or "", api_path=body.api_path or None,
    )


@api.post("/config/flussonic/clear")
async def config_clear(user=Depends(get_current_user)):
    await flussonic.clear_config()
    return await flussonic.get_public_config()


# ---------- Mount domain routers (extracted from server.py for readability) ----------
api.include_router(ssl_routes.router)
api.include_router(server_limits_routes.router)
api.include_router(branding_routes.router)
api.include_router(download_routes.router)


@api.get("/")
async def root():
    return {"service": "flussonic-admin-api", "status": "ok"}


# ---------- Self-update endpoints ----------
api.include_router(updates_module.build_router(require_admin))


app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Startup ----------
@app.on_event("startup")
async def on_startup():
    flussonic.set_db(db)
    updates_module.init(db)
    await db.users.create_index("email", unique=True)
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@flussonic.local").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        await db.users.insert_one({
            "email": admin_email,
            "password_hash": hash_password(admin_password),
            "name": "Admin",
            "role": "admin",
            "parent_id": None,
            "active": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info("Seeded admin user %s", admin_email)
    else:
        update = {}
        if existing.get("role") != "admin":
            update["role"] = "admin"
        if existing.get("parent_id") is not None:
            update["parent_id"] = None
        if not verify_password(admin_password, existing["password_hash"]):
            update["password_hash"] = hash_password(admin_password)
        if update:
            await db.users.update_one({"email": admin_email}, {"$set": update})
            logger.info("Updated admin defaults")


@app.on_event("shutdown")
async def on_shutdown():
    mongo_client.close()
