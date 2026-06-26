"""RBAC scope helpers — used by every route module that filters by user role.

`effective_streams(user)` returns the list of stream names the caller may see,
or None when the caller is an admin (= all streams). `in_my_scope(actor, target_id)`
walks the user tree to verify reseller→client permissions.
"""
from __future__ import annotations

from deps import db


async def get_descendant_ids(root_id: str) -> set[str]:
    """All user IDs in the sub-tree rooted at `root_id` (excludes the root itself)."""
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
    """Return the list of stream names this user may see, or None for 'all'."""
    if user.get("role") == "admin":
        return None
    pool = user.get("streams_allowed")
    return list(pool) if isinstance(pool, list) else []


def serialize_user(doc: dict) -> dict:
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


def validate_subset(child: list[str], parent_pool: list[str] | None) -> list[str]:
    """Ensure child streams are a subset of parent. None parent_pool means 'all allowed'."""
    if parent_pool is None:
        return list(child or [])
    return [s for s in (child or []) if s in parent_pool]
