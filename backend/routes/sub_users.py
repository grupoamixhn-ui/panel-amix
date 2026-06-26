"""Sub-user (reseller / client) CRUD endpoints with RBAC enforcement."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException

from deps import db, hash_password, require_admin_or_reseller
from models import SubUserIn, SubUserUpdateIn
from scope import (
    get_descendant_ids,
    in_my_scope,
    serialize_user,
    validate_subset,
)

router = APIRouter()


@router.get("/sub-users")
async def sub_users_list(user=Depends(require_admin_or_reseller)):
    if user["role"] == "admin":
        cursor = db.users.find({
            "role": {"$in": ["admin", "reseller", "client"]},
            "_id": {"$ne": ObjectId(user["id"])},
        })
    else:
        descendant_ids = await get_descendant_ids(user["id"])
        if not descendant_ids:
            return []
        cursor = db.users.find({"_id": {"$in": [ObjectId(i) for i in descendant_ids]}})
    return [serialize_user(d) async for d in cursor.sort("created_at", -1)]


@router.post("/sub-users")
async def sub_users_create(body: SubUserIn, user=Depends(require_admin_or_reseller)):
    if user["role"] == "reseller" and body.role not in ("reseller", "client"):
        raise HTTPException(status_code=403, detail="Resellers can only create resellers or clients")
    if body.role not in ("admin", "reseller", "client"):
        raise HTTPException(status_code=400, detail="role must be 'admin', 'reseller' or 'client'")
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email already exists")
    if user["role"] == "reseller":
        parent_pool = user.get("streams_allowed") if user["role"] != "admin" else None
        body.streams_allowed = validate_subset(body.streams_allowed, parent_pool)
        cap = user.get("max_sub_users")
        if isinstance(cap, int) and cap > 0:
            descendants = await get_descendant_ids(user["id"])
            if len(descendants) >= cap:
                raise HTTPException(status_code=403, detail=f"Sub-user quota reached ({cap})")
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
        "parent_id": ObjectId(user["id"]) if user.get("id") else None,
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
    return serialize_user(doc)


@router.put("/sub-users/{uid}")
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
        update["streams_allowed"] = validate_subset(body.streams_allowed, parent_pool)
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
        return serialize_user(target)
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.users.update_one({"_id": target_oid}, {"$set": update})
    refreshed = await db.users.find_one({"_id": target_oid})
    return serialize_user(refreshed)


@router.delete("/sub-users/{uid}")
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
    if target.get("role") == "admin":
        remaining = await db.users.count_documents({"role": "admin", "_id": {"$ne": target_oid}})
        if remaining == 0:
            raise HTTPException(status_code=403, detail="Cannot delete the last admin user")
    descendants = await get_descendant_ids(uid)
    descendants.add(uid)
    await db.users.delete_many({"_id": {"$in": [ObjectId(i) for i in descendants]}})
    return {"ok": True, "deleted": len(descendants)}
