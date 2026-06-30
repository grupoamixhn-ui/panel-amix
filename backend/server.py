"""FastAPI application entrypoint.

All routes live in `routes/*.py` and are mounted here under `/api`. Shared
dependencies (db, JWT, current-user) live in `deps.py`; RBAC scope helpers
live in `scope.py`; Pydantic schemas live in `models.py`.

server.py only handles:
  • app construction + CORS middleware
  • mounting all routers under the `/api` prefix
  • startup/shutdown lifecycle (admin seeding, mongo client close)
"""
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter, FastAPI
from starlette.middleware.cors import CORSMiddleware

import flussonic
import updates as updates_module
from deps import db, hash_password, mongo_client, require_admin, verify_password
from routes import auth as auth_routes
from routes import backup as backup_routes
from routes import branding as branding_routes
from routes import config_flussonic as config_flussonic_routes
from routes import download as download_routes
from routes import monitor as monitor_routes
from routes import server_limits as server_limits_routes
from routes import ssl as ssl_routes
from routes import streams as streams_routes
from routes import sub_users as sub_users_routes

# ---------- Setup ----------
app = FastAPI(title="Flussonic Admin API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("flussonic-admin")


# ---------- Mount domain routers ----------
api.include_router(auth_routes.router)
api.include_router(sub_users_routes.router)
api.include_router(streams_routes.router)
api.include_router(monitor_routes.router)
api.include_router(config_flussonic_routes.router)
api.include_router(ssl_routes.router)
api.include_router(server_limits_routes.router)
api.include_router(branding_routes.router)
api.include_router(download_routes.router)
api.include_router(backup_routes.router)
# Self-update endpoints (provided by updates.py)
api.include_router(updates_module.build_router(require_admin))


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
