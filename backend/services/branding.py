"""Custom branding (logo, favicon, brand name, theme colors) persistence.

Backed by MongoDB `config` collection, document `_id == "branding"`. Reads/writes
via `flussonic._DB`, which is initialized at app startup.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import flussonic  # for `_DB` (late-bound: only accessed inside functions)


async def get_branding() -> dict[str, Any]:
    if flussonic._DB is None:  # noqa: SLF001
        return {
            "logo_data_uri": "", "favicon_data_uri": "", "brand_name": "", "tagline": "",
            "primary_color": "", "primary_hover": "", "primary_soft": "",
        }
    doc = await flussonic._DB.config.find_one({"_id": "branding"}) or {}  # noqa: SLF001
    return {
        "logo_data_uri": doc.get("logo_data_uri", ""),
        "favicon_data_uri": doc.get("favicon_data_uri", ""),
        "brand_name": doc.get("brand_name", ""),
        "tagline": doc.get("tagline", ""),
        "primary_color": doc.get("primary_color", ""),
        "primary_hover": doc.get("primary_hover", ""),
        "primary_soft": doc.get("primary_soft", ""),
    }


async def save_branding(
    *,
    logo_data_uri: str | None = None,
    favicon_data_uri: str | None = None,
    brand_name: str | None = None,
    tagline: str | None = None,
    primary_color: str | None = None,
    primary_hover: str | None = None,
    primary_soft: str | None = None,
) -> dict[str, Any]:
    if flussonic._DB is None:  # noqa: SLF001
        raise RuntimeError("DB not initialized")
    update: dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if logo_data_uri is not None:
        update["logo_data_uri"] = logo_data_uri
    if favicon_data_uri is not None:
        update["favicon_data_uri"] = favicon_data_uri
    if brand_name is not None:
        update["brand_name"] = brand_name
    if tagline is not None:
        update["tagline"] = tagline
    if primary_color is not None:
        update["primary_color"] = primary_color
    if primary_hover is not None:
        update["primary_hover"] = primary_hover
    if primary_soft is not None:
        update["primary_soft"] = primary_soft
    await flussonic._DB.config.update_one({"_id": "branding"}, {"$set": update}, upsert=True)  # noqa: SLF001
    return await get_branding()


async def clear_branding_logo() -> dict[str, Any]:
    if flussonic._DB is not None:  # noqa: SLF001
        await flussonic._DB.config.update_one(  # noqa: SLF001
            {"_id": "branding"}, {"$set": {"logo_data_uri": ""}}, upsert=True,
        )
    return await get_branding()


async def clear_branding_favicon() -> dict[str, Any]:
    if flussonic._DB is not None:  # noqa: SLF001
        await flussonic._DB.config.update_one(  # noqa: SLF001
            {"_id": "branding"}, {"$set": {"favicon_data_uri": ""}}, upsert=True,
        )
    return await get_branding()
