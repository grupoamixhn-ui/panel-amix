from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import logging
import base64
import asyncio
import hashlib
import subprocess
from datetime import datetime, timezone, timedelta
from typing import Any

import bcrypt
import jwt
from bson import ObjectId
from bson.errors import InvalidId
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, UploadFile, File, Form
from fastapi.responses import FileResponse, PlainTextResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field
from starlette.middleware.cors import CORSMiddleware

import flussonic

# ---------- Setup ----------
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

JWT_ALGO = "HS256"
JWT_SECRET = os.environ["JWT_SECRET"]

app = FastAPI(title="Flussonic Admin API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("flussonic-admin")


# ---------- Auth helpers ----------
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False

def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(hours=12),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        try:
            uid = ObjectId(payload["sub"])
        except InvalidId:
            raise HTTPException(status_code=401, detail="Invalid token")
        user = await db.users.find_one({"_id": uid})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        # Reject expired users
        if user.get("expires_at"):
            try:
                exp = datetime.fromisoformat(user["expires_at"])
                if exp.tzinfo is None:
                    exp = exp.replace(tzinfo=timezone.utc)
                if exp < datetime.now(timezone.utc):
                    raise HTTPException(status_code=403, detail="Account expired")
            except (TypeError, ValueError):
                pass
        user["_id"] = str(user["_id"])
        user["id"] = user["_id"]
        user.pop("password_hash", None)
        if user.get("parent_id"):
            user["parent_id"] = str(user["parent_id"])
        if user.get("created_by"):
            user["created_by"] = str(user["created_by"])
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ---------- Role / scope helpers ----------
def require_admin_or_reseller(user=Depends(get_current_user)):
    if user.get("role") not in ("admin", "reseller"):
        raise HTTPException(status_code=403, detail="Forbidden")
    return user


def require_admin(user=Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    return user


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

class StreamUpdateIn(BaseModel):
    url: str | None = None
    title: str | None = None
    publish_password: str | None = None
    max_bitrate_kbps: int | None = None
    source_timeout: int | None = None

class ToggleIn(BaseModel):
    start: bool


class FlussonicConfigIn(BaseModel):
    url: str = ""
    user: str = ""
    password: str | None = None  # None = keep existing
    api_path: str | None = None
    public_host: str | None = None
    srt_port: int | None = None
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
    return await flussonic.get_server_info()

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
    return await flussonic.get_stats_timeseries(points)


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
        rtmp_port=body.rtmp_port, https=body.https,
    )
    return await flussonic.get_public_config()


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


# ---------- Branding (logo, brand name) ----------
@api.get("/branding")
async def branding_get():
    """Public — no auth so the login page can render the logo."""
    return await flussonic.get_branding()


_LOGO_MAX_BYTES = 1_000_000  # 1MB
_LOGO_MIME = {"image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp", "image/gif"}
import re as _re
_HEX_COLOR_RE = _re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")


def _validate_color(value: str | None, field: str) -> str | None:
    if value is None or value == "":
        return value  # None = unchanged, "" = clear
    if not _HEX_COLOR_RE.match(value):
        raise HTTPException(status_code=400, detail=f"{field} must be a hex color like #2563EB")
    return value


@api.post("/branding")
async def branding_post(
    logo: UploadFile | None = File(default=None),
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
    return await flussonic.save_branding(
        logo_data_uri=data_uri,
        brand_name=brand_name,
        tagline=tagline,
        primary_color=_validate_color(primary_color, "primary_color"),
        primary_hover=_validate_color(primary_hover, "primary_hover"),
        primary_soft=_validate_color(primary_soft, "primary_soft"),
    )


@api.delete("/branding/logo")
async def branding_logo_clear(user=Depends(get_current_user)):
    return await flussonic.clear_branding_logo()


@api.get("/")
async def root():
    return {"service": "flussonic-admin-api", "status": "ok"}


# ---------- Self-hosted installer download ----------
# These endpoints expose the install tarball so admins can fetch it from a
# fresh VPS via a single curl/wget. The tarball is built on-demand from the
# bundled make-release.sh and cached on disk.
INSTALL_DIR = ROOT_DIR.parent / "install"
DIST_DIR = ROOT_DIR.parent / "dist"
_release_build_lock = asyncio.Lock()


async def _ensure_release_built() -> Path | None:
    """Return the newest tarball in dist/, building one on the fly if missing."""
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    candidates = sorted(DIST_DIR.glob("flussonic-admin-*.tar.gz"), key=lambda p: p.stat().st_mtime, reverse=True)
    if candidates:
        return candidates[0]
    script = INSTALL_DIR / "make-release.sh"
    if not script.is_file():
        return None
    async with _release_build_lock:
        candidates = sorted(DIST_DIR.glob("flussonic-admin-*.tar.gz"), key=lambda p: p.stat().st_mtime, reverse=True)
        if candidates:
            return candidates[0]
        proc = await asyncio.create_subprocess_exec(
            "bash", str(script), "--out", str(DIST_DIR),
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        )
        out, _ = await proc.communicate()
        if proc.returncode != 0:
            logger.error("make-release.sh failed (%s): %s", proc.returncode, out.decode(errors="replace")[-500:])
            return None
    candidates = sorted(DIST_DIR.glob("flussonic-admin-*.tar.gz"), key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0] if candidates else None


@api.get("/download/installer/info")
async def download_installer_info(request: Request):
    """Public metadata about the latest release tarball + a ready-to-paste
    curl one-liner. Public on purpose so a fresh VPS can fetch it without auth."""
    tarball = await _ensure_release_built()
    if not tarball:
        raise HTTPException(status_code=503, detail="Release tarball not available — make-release.sh missing or failed")
    data = tarball.read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    # Honor reverse-proxy headers so the URL matches the public scheme/host.
    fwd_proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    fwd_host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    public_url = f"{fwd_proto}://{fwd_host}/api/download/installer"
    inner_dir = tarball.name[:-len(".tar.gz")]
    return {
        "filename": tarball.name,
        "version": inner_dir.replace("flussonic-admin-", ""),
        "size_bytes": len(data),
        "sha256": sha,
        "download_url": public_url,
        "curl_oneliner": (
            f"curl -fsSL '{public_url}' -o /tmp/{tarball.name} && "
            f"cd /tmp && tar xzf {tarball.name} && cd {inner_dir} && "
            f"sudo bash install/install.sh"
        ),
    }


@api.get("/download/installer", name="download_installer")
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


@api.post("/download/installer/rebuild")
async def rebuild_installer(user=Depends(get_current_user)):
    """Force-rebuild the tarball (admin-only). Use after code changes."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    for old in DIST_DIR.glob("flussonic-admin-*.tar.gz"):
        try:
            old.unlink()
        except OSError:
            pass
    tarball = await _ensure_release_built()
    if not tarball:
        raise HTTPException(status_code=500, detail="Rebuild failed — check backend logs")
    return {"ok": True, "filename": tarball.name, "size_bytes": tarball.stat().st_size}


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
    client.close()
