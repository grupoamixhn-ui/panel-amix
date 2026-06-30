"""Pydantic request/response schemas shared across route modules."""
from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field


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
    max_sessions: int | None = None          # per-stream concurrent viewer cap
    srt_publish_port: int | None = None
    srt_publish_passphrase: str | None = None
    srt_play_port: int | None = None
    srt_play_passphrase: str | None = None
    client_timeout: int | None = None


class StreamUpdateIn(BaseModel):
    url: str | None = None
    title: str | None = None
    publish_password: str | None = None
    max_bitrate_kbps: int | None = None
    source_timeout: int | None = None
    max_sessions: int | None = None
    srt_publish_port: int | None = None
    srt_publish_passphrase: str | None = None
    srt_play_port: int | None = None
    srt_play_passphrase: str | None = None
    client_timeout: int | None = None


class ToggleIn(BaseModel):
    start: bool


class StreamPushIn(BaseModel):
    url: str
    label: str = ""


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


class SubUserIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=4, max_length=80)
    role: str  # "admin" | "reseller" | "client"
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
