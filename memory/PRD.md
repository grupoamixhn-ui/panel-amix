# Flussonic Admin Panel — PRD

## Original Problem Statement
> admin flussonic api

User wants a web admin panel for the Flussonic Media Server API. Confirmed via clarifying questions:
- Stack: React + FastAPI panel that consumes the Flussonic Media Server API (+ backend proxy)
- Features: stream management, live monitoring, statistics & logs
- Auth: custom JWT login
- Flussonic credentials: not provided — running in DEMO_MODE with realistic mock data
- Design: NOC-style dark theme (chosen — Performance Pro archetype)

## Architecture
- Backend: FastAPI (`/app/backend/server.py`) + Flussonic client wrapper (`/app/backend/flussonic.py`)
  - JWT (PyJWT) auth, bcrypt password hashing, httpOnly cookie + Bearer header
  - Admin user seeded on startup from `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars
  - All endpoints under `/api`, protected by `get_current_user`
- Frontend: React 19 + react-router 7 + recharts + lucide-react + IBM Plex Sans/Mono
  - AuthContext, route guards, axios with `withCredentials` + Bearer interceptor
- Mongo: motor; `users` collection with unique-email index
- Flussonic integration: DEMO_MODE returns synthetic data (8 streams, sessions, time-series, logs). Real mode proxies `/streamer/api/v3` (server, streams, sessions).

## User Personas
- **NOC operator / streaming engineer** — monitors live streams, sessions, bandwidth in real time; needs dense data and fast actions.
- **Platform admin** — creates / edits / removes streams and configures source URLs / DVR.

## Core Requirements (static)
1. Custom JWT login (admin only).
2. Dashboard with KPIs (live streams, viewers, bandwidth, uptime) + live charts.
3. Stream CRUD (create, edit, start/stop, delete) with search.
4. Sessions list (real-time, filterable by protocol).
5. Statistics page (historical viewers/bandwidth + per-stream top viewers chart).
6. Logs page (terminal style, level filter, pause/resume).
7. Settings page (connection mode, env hints, supported API surface).
8. Easy switch to a real Flussonic server via .env vars.

## What's Been Implemented (2026-06-24)
- ✅ JWT auth (`/api/auth/login`, `/auth/me`, `/auth/logout`) + admin seeding
- ✅ Flussonic client wrapper (demo + real httpx-based)
- ✅ Endpoints: `/server/info`, `/streams` (GET/POST/GET/PUT/DELETE), `/streams/{name}/toggle`, `/sessions`, `/stats`, `/logs`, `/monitor/metrics`
- ✅ Login page (NOC dark theme, image background)
- ✅ Dashboard with 4 KPIs, viewers & bandwidth area charts, top streams
- ✅ Streams page (table, search, modal CRUD, start/stop, delete)
- ✅ Sessions page (live table, protocol filter)
- ✅ Stats page (history + per-stream bar chart)
- ✅ Settings page (Flussonic connection editor, branding)
- ✅ Resellers/Clients RBAC with stream + viewer quotas
- ✅ Stream Wizard (SRT/RTMP/HLS), embedded hls.js preview
- ✅ Real-time Monitor page (CPU, RAM, Bandwidth in/out, Viewers, Streams) with rolling 60-sample window, 3s refresh, graceful 404 handling for `/server` endpoint blocked by reverse proxy (2026-06-24)
- ✅ Per-stream RTMP/SRT publish password (Flussonic `password` field). Wizard exposes "Publish password" with show/hide toggle; Outputs modal shows the `?password=` suffix + split Server/Stream Key for OBS. Update flow uses fetch-merge-PUT against Flussonic v3 (2026-06-24)
- ✅ Reset button per stream (POST /api/streams/{name}/reset) — toggles Flussonic `disabled` False→True→False via fetch-merge-PUT, kicks current viewers and forces source reconnect. RBAC-gated by effective_streams. RotateCw icon button in Streams table with spinner + confirm dialog. Also refactored toggle_stream to use the same disabled-flag approach (the /restart, /stop POST endpoints don't exist in Flussonic 24.02) (2026-06-24)
- ✅ Self-hosted installer for Ubuntu 22/24, Debian 11/12, AlmaLinux/Rocky 8/9 at `/app/install/`: install.sh (native deps + Python venv + React static build + MongoDB 7 + nginx reverse proxy + systemd unit `flussonic-admin` + optional Let's Encrypt via `--domain`), uninstall.sh, README.md. Idempotent re-runs preserve `.env` (JWT_SECRET, ADMIN_PASSWORD) and MongoDB data (2026-06-24)
- ✅ Installer distribution via the deployed panel: 3 new endpoints (`GET /api/download/installer/info` public metadata + curl one-liner, `GET /api/download/installer` public tarball download, `POST /api/download/installer/rebuild` admin-only). Tarball built on-demand from `make-release.sh`, cached in `/app/dist/`. New "Self-hosted installer" card in Settings with Download button + copy-paste curl one-liner + SHA-256 + rebuild button (2026-06-24)

## Prioritized Backlog
**P1 (post-MVP polish)**
- Add `data-testid="new-stream-modal"` to the streams modal (testing-agent suggestion)
- Add `chart-*` testids on the /stats page
- Catch `bson.errors.InvalidId` in `get_current_user` to return 401 on malformed JWT subs
- Migrate from `@app.on_event` to FastAPI lifespan handlers
- Set cookie `secure=True` when behind HTTPS (env-driven)

**P2 (features)**
- Stream detail page with embedded HLS preview (hls.js)
- DVR archive timeline browser
- Multi-server (cluster) selector
- Multi-user roles (admin / viewer / operator)
- Audit log persisted in MongoDB
- Real Flussonic stats endpoints integration (per-version)
- Webhooks / SSE push for sessions instead of polling

## Next Tasks
- Wait for the user to test the demo and supply real Flussonic credentials, then flip DEMO_MODE=false.
- Apply P1 polish items if requested.
