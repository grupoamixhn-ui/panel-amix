from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import logging
from datetime import datetime, timezone, timedelta
from typing import Any

import bcrypt
import jwt
from bson import ObjectId
from bson.errors import InvalidId
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends
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
        user["_id"] = str(user["_id"])
        user.pop("password_hash", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ---------- Schemas ----------
class LoginIn(BaseModel):
    email: EmailStr
    password: str

class StreamIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    url: str = Field(min_length=1)
    title: str = ""
    dvr: bool = False

class StreamUpdateIn(BaseModel):
    url: str | None = None
    title: str | None = None
    dvr: bool | None = None

class ToggleIn(BaseModel):
    start: bool


class FlussonicConfigIn(BaseModel):
    url: str = ""
    user: str = ""
    password: str | None = None  # None = keep existing
    demo_mode: bool = False
    api_path: str | None = None


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


# ---------- Flussonic endpoints ----------
@api.get("/server/info")
async def server_info(user=Depends(get_current_user)):
    return await flussonic.get_server_info()

@api.get("/streams")
async def streams_list(user=Depends(get_current_user)):
    return await flussonic.list_streams()

@api.post("/streams")
async def streams_create(body: StreamIn, user=Depends(get_current_user)):
    try:
        return await flussonic.create_stream(body.name, body.url, body.title, body.dvr)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

@api.get("/streams/{name}")
async def streams_get(name: str, user=Depends(get_current_user)):
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

@api.get("/sessions")
async def sessions_list(user=Depends(get_current_user)):
    return await flussonic.list_sessions()

@api.get("/stats")
async def stats(points: int = 30, user=Depends(get_current_user)):
    return await flussonic.get_stats_timeseries(points)

@api.get("/logs")
async def logs_list(limit: int = 100, user=Depends(get_current_user)):
    return await flussonic.list_logs(limit)


# ---------- Flussonic connection config ----------
@api.get("/config/flussonic")
async def config_get(user=Depends(get_current_user)):
    return await flussonic.get_public_config()


@api.put("/config/flussonic")
async def config_put(body: FlussonicConfigIn, user=Depends(get_current_user)):
    await flussonic.save_config(
        url=body.url, user=body.user, password=body.password,
        demo_mode=body.demo_mode, api_path=body.api_path,
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


@api.get("/")
async def root():
    return {"service": "flussonic-admin-api", "status": "ok"}


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
            "created_at": datetime.now(timezone.utc),
        })
        logger.info("Seeded admin user %s", admin_email)
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one(
            {"email": admin_email},
            {"$set": {"password_hash": hash_password(admin_password)}},
        )
        logger.info("Updated admin password from env")


@app.on_event("shutdown")
async def on_shutdown():
    client.close()
