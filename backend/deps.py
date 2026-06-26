"""Shared FastAPI dependencies + auth helpers used across route modules.

Keeping these here (rather than in `server.py`) avoids circular imports when
route modules grow into their own files under `routes/`.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone, timedelta
from pathlib import Path

import bcrypt
import jwt
from bson import ObjectId
from bson.errors import InvalidId
from fastapi import Depends, HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorClient

# Resolve .env via the backend root so unit tests + uvicorn agree
ROOT_DIR = Path(__file__).parent

# ---------- Mongo ----------
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
mongo_client = AsyncIOMotorClient(MONGO_URL)
db = mongo_client[DB_NAME]

# ---------- JWT ----------
JWT_ALGO = "HS256"
JWT_SECRET = os.environ["JWT_SECRET"]


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:  # noqa: BLE001
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


def require_admin(user=Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    return user


def require_admin_or_reseller(user=Depends(get_current_user)) -> dict:
    if user.get("role") not in ("admin", "reseller"):
        raise HTTPException(status_code=403, detail="Forbidden")
    return user
