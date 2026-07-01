"""Backup/restore endpoints — exports panel database (users + branding + config)
as a single JSON file the admin can download, and imports it back on a fresh
install (or after a disaster). Streams themselves live on Flussonic, not here,
so the backup focuses on what the panel owns: user accounts, RBAC quotas,
branding, SSL config, Flussonic connection settings.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response

from deps import db, require_admin

router = APIRouter()

BACKUP_VERSION = 1
COLLECTIONS_TO_BACKUP = ("users", "config")


def _serialize(obj: Any) -> Any:
    """Recursively convert BSON-only types (ObjectId, datetime) to JSON-safe."""
    if isinstance(obj, ObjectId):
        return {"__oid__": str(obj)}
    if isinstance(obj, datetime):
        return {"__dt__": obj.isoformat()}
    if isinstance(obj, list):
        return [_serialize(v) for v in obj]
    if isinstance(obj, dict):
        return {k: _serialize(v) for k, v in obj.items()}
    return obj


def _deserialize(obj: Any) -> Any:
    """Inverse of _serialize — restore ObjectId / datetime markers."""
    if isinstance(obj, dict):
        if "__oid__" in obj and len(obj) == 1:
            return ObjectId(obj["__oid__"])
        if "__dt__" in obj and len(obj) == 1:
            try:
                return datetime.fromisoformat(obj["__dt__"])
            except ValueError:
                return obj["__dt__"]
        return {k: _deserialize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_deserialize(v) for v in obj]
    return obj


@router.get("/backup/export")
async def backup_export(user=Depends(require_admin)):
    """Download a JSON backup of users + config collections."""
    payload: dict[str, Any] = {
        "version": BACKUP_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "exported_by": user.get("email"),
        "collections": {},
    }
    for coll_name in COLLECTIONS_TO_BACKUP:
        docs = []
        async for doc in db[coll_name].find({}):
            docs.append(_serialize(doc))
        payload["collections"][coll_name] = docs

    body = json.dumps(payload, ensure_ascii=False, indent=2)
    filename = f"amixpanel-backup-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.json"
    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/backup/info")
async def backup_info(user=Depends(require_admin)):
    """Return a quick summary of what a backup would contain."""
    counts: dict[str, int] = {}
    for coll_name in COLLECTIONS_TO_BACKUP:
        counts[coll_name] = await db[coll_name].count_documents({})
    return {
        "version": BACKUP_VERSION,
        "collections": list(COLLECTIONS_TO_BACKUP),
        "counts": counts,
    }


@router.post("/backup/import")
async def backup_import(
    file: UploadFile = File(...),
    merge: bool = False,
    user=Depends(require_admin),
):
    """Restore from a previously exported backup.

    - merge=False (default): wipe each restored collection before inserting.
    - merge=True: upsert each document, keeping anything already in Mongo that
      isn't in the backup. Useful for partial restores.

    The current admin is never deleted — even when merge=False we re-insert it
    so the operator can't lock themselves out of the panel.
    """
    try:
        raw = await file.read()
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise HTTPException(status_code=400, detail=f"Invalid backup file: {e}")
    if not isinstance(payload, dict) or payload.get("version") != BACKUP_VERSION:
        raise HTTPException(status_code=400, detail="Unsupported backup format/version")
    colls = payload.get("collections") or {}
    if not isinstance(colls, dict):
        raise HTTPException(status_code=400, detail="Backup is missing `collections`")

    summary: dict[str, int] = {}
    current_admin_id = ObjectId(user["id"])

    for coll_name, docs in colls.items():
        if coll_name not in COLLECTIONS_TO_BACKUP:
            continue
        if not isinstance(docs, list):
            continue
        restored = [_deserialize(d) for d in docs]
        if not merge:
            # Preserve the current admin so the operator isn't locked out
            if coll_name == "users":
                await db.users.delete_many({"_id": {"$ne": current_admin_id}})
            else:
                await db[coll_name].delete_many({})
        for doc in restored:
            if not isinstance(doc, dict) or "_id" not in doc:
                continue
            # Don't overwrite the currently logged-in admin with a stale copy
            if coll_name == "users" and doc["_id"] == current_admin_id:
                continue
            await db[coll_name].replace_one({"_id": doc["_id"]}, doc, upsert=True)
        summary[coll_name] = len(restored)
    return {
        "ok": True,
        "restored": summary,
        "merge": merge,
        "version": payload.get("version"),
    }
