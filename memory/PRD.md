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
- ✅ CPU/RAM monitor now reads from `/streamer/api/v3/config` (was 404 on `/server`); brand color picker + "Use logo colors" auto-extract in Branding settings; admin role can now create other admin users via /sub-users (2026-06-24)
- ✅ Demo mode REMOVED entirely (backend + frontend); RTMP publish URL now uses Flussonic `/static/` application path; per-stream `max_bitrate_kbps` and `source_timeout` fields added to Stream wizard with server-wide max_sessions/client_timeout disclaimer (2026-06-24)
- ✅ Server-wide limits card in Settings (GET/PUT `/api/server/limits`): editable `max_sessions` (pushed to Flussonic via PUT /config root level, admin-only) + read-only `client_timeout=60` with copyable `/etc/flussonic/flussonic.conf` snippet. Default set to 400 per user request (2026-06-24)
- ✅ `max_bitrate_kbps` unit fix — Flussonic stores in bits/sec, UI shows kbit/s (was incorrectly /8 conversion); RTSP and DASH removed from Outputs modal; RTMP pull URL now includes /static/ matching publish; new `publisher_ip` + `publisher_proto` fields exposed in /api/streams (from stats.published_from / published_via). Streams table "Source" column shows colored SRT (purple) / RTMP (orange) badge + publisher IP for active push streams (2026-06-24)
- ✅ Per-stream Live Monitor modal (`StreamLiveMonitor.jsx`) wired to `GET /api/streams/{name}/live-stats` — Recharts time-series for input/output bitrate + bandwidth, plus video/audio codec/resolution/fps panel (2026-06-25)
- ✅ SRT publish URL no longer appends `:PASSWORD` — SRT on Flussonic does not support per-stream password via streamid. RTMP keeps the `?password=` suffix. Updated Outputs modal copy + StreamWizard label to clarify "Publish password · RTMP only" (2026-06-25)
- ✅ Social media push targets (`PushTargetsModal.jsx`) — `GET/POST /api/streams/{name}/pushes` for FB/YouTube/TikTok/Instagram/Custom RTMP destinations (2026-06-25)
- ✅ SSL Section in Settings — Let's Encrypt automation + manual upload + sudoers helper for Nginx (2026-06-25)
- ✅ Auto-detection of SRT/RTMP ports via `/api/config/flussonic/detect-ports` (2026-06-25)
- ✅ RBAC UI restrictions on Streams page for `client` role — hides "New stream", Edit, Delete buttons. Imported `useAuth` from `../auth`. Verified with screenshot using `client.test@flussonic.io` (2026-06-25)
- ✅ Client role now sees Sessions + Statistics pages, all data scoped to assigned `streams_allowed`. Backend `/server/info` and `/stats` filter KPIs by user scope (admin sees global; reseller/client sees only assigned). Verified: 3 assigned streams → 3 visible, 1 session shown, KPIs reflect scoped totals (2026-06-25)
- ✅ Installer bug fix: `unbound variable SSL_CERT` in `install.sh` line 232 — moved `SSL_CERT_DIR/SSL_CERT/SSL_KEY` defs above the `.env` block so they're always defined under `set -u` (2026-06-25)
- ✅ Removed hardcoded "GRUPO AMIX HN" from Login. Brand name + tagline now driven 100% by `/api/branding`. Dynamic favicon: uploaded `logo_data_uri` is applied as `<link rel="icon">`. `document.title = "{brand_name} · {tagline}"` (2026-06-25)
- ✅ Self-update system: `/api/updates/{status,config,check,upload,apply,rollback}` endpoints + `UpdateSection.jsx` in Settings + sidebar badge "NEW" when update available. Sources: GitHub releases / Custom URL (mirrors any other panel's `/info` endpoint) / Manual upload / Disabled. Quick mode (replace backend+frontend, restart) and Full mode (re-run install.sh). Rollback restores `/opt/flussonic-admin.bak`. Helper script `flussonic-admin-update.sh` + sudoers entry installed by `install.sh`. Auto-check polling every N hours (default 6) (2026-06-25)
- ✅ Universal cross-OS installer hardening (2026-06-26):
  - EPEL + CRB/PowerTools auto-enabled on RHEL family (AlmaLinux/Rocky/RHEL 8/9/10) so `certbot`, `python3-certbot-nginx` and pip-wheel build deps are available
  - `dnf module reset/disable nodejs` before NodeSource install — prevents conflicts with RHEL's bundled Node modules
  - Python 3.11 detection: tries `python3.11`/`python3.11-devel`, falls back to system `python3`/`python3-devel` when not in repos
  - Added `policycoreutils-python-utils` + `semanage port -a http_port_t` for non-standard nginx listen ports on SELinux-enforcing hosts
  - MongoDB 7 RHEL repo now uses the actual major version (`rpm -E %rhel`) instead of `$releasever`, with RHEL 10→9 ABI fallback
  - Firewall opens port 80 (HTTP-01 challenge) when `--domain` is set, both ufw and firewalld branches
  - `make-release.sh` now runs `bash -n` + `shellcheck -S error` gate on all bash scripts before packaging — broken installers never ship
  - Tarball regenerated: `/app/dist/flussonic-admin-2026.06.26-*.tar.gz`
- ✅ Real-time Monitor enhancements (2026-06-26):
  - Hardware & Runtime card on Monitor page exposing CPU model, cores/threads, total RAM (+ used %), kernel, OS/arch, Flussonic version + hostname + uptime. New `GET /api/server/hardware` endpoint reads `/proc/cpuinfo` + `/proc/meminfo` + `platform.uname()` for the panel host and Flussonic `/config` + `/server` for the streamer.
  - Combined "Bandwidth IN vs OUT" chart overlays both lines in a single panel below the split IN/OUT charts, plus a live `ratio = OUT/IN ×` indicator so operators can read cache amplification at a glance.
- ✅ Backend refactor — split `server.py` from 1097 → 686 lines (-37%) (2026-06-26):
  - New `/app/backend/deps.py`: shared Mongo client, JWT secret, password helpers, `get_current_user`, `require_admin`, `require_admin_or_reseller` — eliminates circular imports.
  - New `/app/backend/routes/` package with domain routers mounted via `api.include_router()`:
    * `ssl.py` (3 endpoints, 163 lines) — SSL status, upload, Let's Encrypt automation
    * `branding.py` (4 endpoints, 83 lines) — logo, favicon, theme colors, brand name
    * `download.py` (3 endpoints, 115 lines) — installer tarball download + curl one-liner + rebuild
    * `server_limits.py` (2 endpoints, 43 lines) — Flussonic server-wide limits CRUD
  - All routes preserve their public paths (e.g. `/api/ssl/status`, `/api/branding`) — zero API surface change.
  - Smoke-tested all 13 endpoints (auth/me, streams, sessions, stats, monitor, config, ssl, branding, server/hardware, server/limits, sub-users, pushes, download) — all return 200.
- ✅ SRT dedicated publish/play ports + passphrases + client_timeout per stream (2026-06-30):
  - Backend: new optional fields in `create_stream` / `update_stream` / `_normalize_stream` — `srt_publish_port`, `srt_publish_passphrase`, `srt_play_port`, `srt_play_passphrase`, `client_timeout`. Pushed to Flussonic via `/streamer/api/v3/streams/{name}` PUT (Flussonic accepts them as top-level keys on the stream config).
  - Frontend `StreamWizard.jsx`: new "SRT dedicated ports (optional)" section after Max simultaneous viewers, with 4 inputs (publish port, publish passphrase, play port, play passphrase) + a separate Client timeout field. 0 / empty fields are dropped on save so Flussonic uses its default (shared) ports.
  - Pydantic schemas `StreamIn` / `StreamUpdateIn` extended in `models.py`. Streams route forwards the new args to flussonic.create_stream.
  - Verified visually in the Modify Stream modal — all 5 fields render with proper placeholders & helper text. Tarball regenerated.
- ✅ Geographic viewers map on Stream detail page (2026-06-30):
  - New `ViewersMap.jsx` component: world choropleth using `react-simple-maps` + world-atlas 110m TopoJSON (CDN-served, no build asset).
  - Groups active sessions by 2-letter country code, maps to UN M49 numeric IDs (which the TopoJSON uses as `geo.id`), paints each country on a green→red scale based on viewer count.
  - Hover tooltip shows country name + exact viewer count. "Top countries" sidebar lists the 6 countries with most viewers + total counts.
  - Inserted between the Output/Sessions/Pushes summary cards and the Active viewers table, only shown when `sessions.length > 0`.
  - Verified live: stream with 6 viewers shows US (5, dark red) and Canada (1, green) painted correctly.
- ✅ Fix tanda 5 problemas reportados por el usuario (2026-06-30):
  1. **Bug crítico de bitrate**: Flussonic 24+ devuelve `bitrate` / `input_bitrate` en **kbit/s** (no bps como se asumía). El panel mostraba "2.5 kbps" para un stream HD de 2.5 Mbps. Fix en `flussonic.py::_normalize_stream` y `get_stream_live_stats` para multiplicar por 1000 sólo cuando la fuente es el campo kbps.
  2. **Output Bandwidth = 0 bps**: Flussonic no expone `out_bandwidth` directamente en `/streams/{name}`, sólo `bytes_out` acumulado. Calculamos estimación viva como `clients × input_bitrate` (cada viewer consume ≈ el input bitrate). Stream con 2 viewers ahora muestra 5.08 Mbps correctamente.
  3. **Publisher IP no visible**: la IP estaba en `data.inputs[0].stats.ip` (camino que el normalizer no probaba). Agregado a la lista de campos consultados. Ahora cada row del Streams list muestra `SRT · 190.109.214.122` / `RTMP · 192.187.102.130` en vez del genérico "publisher connected".
  4. **Cliente veía botones Edit/Delete** en el StreamDetail: gated detrás de `canManage = role==='admin' || role==='reseller'`.
  5. **Default max_bitrate** en StreamWizard cambiado a **5120 kbps** (5 Mbps) cuando se crea un stream nuevo (antes era 0 = unlimited).
- ✅ Reemplazado tab "Flussonic Install" por tab **"Backup"** en Settings (2026-06-30):
  - Removido `routes/flussonic_admin.py` y `services/flussonic_setup.py` del mount (siguen en disco para retomar después si hace falta).
  - Nuevo `routes/backup.py` con 3 endpoints: `GET /api/backup/info` (counts), `GET /api/backup/export` (download JSON), `POST /api/backup/import?merge=…` (restore con preservación del admin actual).
  - Frontend `BackupSection.jsx` con stat cards (users, config docs, format version), botones "Download backup" y "Restore from file…" + toggle "Merge mode".
  - Smoke-test: backup JSON de 120 KB con 6 users + 4 config docs exporta limpio.
  - New route `/streams/:name` and page `StreamDetail.jsx` — clicking a stream name in the list opens a dedicated view.
  - **HLS player** at the top (reuses `HlsPlayer.jsx`) auto-detects the highest-quality `.m3u8` from `/streams/{name}/outputs`, falls back to a friendly "Preview unavailable" message when CORS blocks playback. Mute/unmute toggle + LIVE badge.
  - **KPIs sidebar** (6 cards): viewers, input bitrate, output bandwidth, uptime, video codec/res/fps, audio codec/rate/channels.
  - **Live charts**: bitrate IN/OUT overlay + viewers line chart, polling every 2.5s with 60-point rolling window (~2.5 min history).
  - **Summary count cards** for Output URLs / Active sessions / Push targets — clicking opens the corresponding existing modal.
  - **Active viewers table** (first 30): IP, country, protocol, bitrate, bytes sent, duration.
  - **Push targets list** with status pill + label + URL + bytes-sent.
  - **Source info card**: URL, publisher IP/proto, max_bitrate, max_sessions.
  - Action buttons in header: Start/Stop, Reset, Edit (opens `StreamWizard`), Delete (with confirm + nav back to /streams).
  - All elements have stable `data-testid` for automation: `stream-detail-page`, `hls-player`, `kpi-viewers/input/output/uptime/video/audio`, `chart-bitrate`, `chart-viewers`, `outputs-summary`, `sessions-summary`, `pushes-summary`, `sessions-table`, `pushes-table`, `source-info`.
  - Verified live with stream `QhuboTv` on user's Flussonic — HLS plays, viewers=30, bitrate=3.93 Mbps, video=h264 1280×720 @ 29.97 fps, audio=aac 48000 Hz 2ch.
- ✅ "Install Flussonic" + License Key management (2026-06-26):
  - New Settings → **Flussonic** tab with two cards: (1) Install Flussonic Media Server with optional license-key field + live log viewer streaming the installer's stdout in real time, (2) License Key card showing edition / valid-until / masked current key + input to save+push a new key.
  - Backend: `services/flussonic_setup.py` runs the official installer (`/usr/local/bin/flussonic-admin-install-flussonic` via sudoers — only allows HTTPS URLs on the flussonic.com origin for safety). After install completes successfully, the panel auto-detects Flussonic on localhost and saves the connection config so the rest of the panel works without manual setup.
  - License: stored in MongoDB `config.flussonic_license` and pushed to `PUT /streamer/api/v3/config` with `{"key": "..."}` so Flussonic hot-reloads.
  - 5 new admin-only endpoints: `GET /api/flussonic/detect`, `POST /api/flussonic/install`, `GET /api/flussonic/install/status`, `GET /api/flussonic/license`, `PUT /api/flussonic/license`.
  - New helper script `install/flussonic-admin-install-flussonic.sh` + sudoers entry installed by `install.sh`. Tarball regenerated.
- ✅ Backend refactor — complete extraction of routes + service-layer split (2026-06-26):
  - `server.py` further reduced to **110 lines** (-90% from original 1097) — now only app setup, middleware, router mounts, startup/shutdown.
  - New `/app/backend/models.py` (82 ln): all Pydantic schemas (Login, Stream*, FlussonicConfig*, SubUser*).
  - New `/app/backend/scope.py` (68 ln): RBAC helpers `get_descendant_ids`, `in_my_scope`, `effective_streams`, `serialize_user`, `validate_subset`.
  - New routes: `auth.py` (45 ln), `sub_users.py` (142 ln), `streams.py` (190 ln, includes pushes), `monitor.py` (75 ln, includes sessions/stats/server-info/hardware), `config_flussonic.py` (60 ln).
  - `flussonic.py` reduced 1320 → 983 lines (-25%) via service-layer split: new `/app/backend/services/` package with `branding.py` (76 ln), `server_limits.py` (86 ln), `pushes.py` (94 ln), `hardware.py` (141 ln). Facade pattern preserves backward compat — `flussonic.py` re-exports public names at the bottom.
  - 16 endpoints smoke-tested → all 200. Zero regressions vs pre-refactor pytest baseline (same 13 pre-existing failures, all related to Flussonic config drift not the refactor).

## Prioritized Backlog
**P1 (post-MVP polish)**
- CDN Multi-server architecture (Origin + Edges) — replicate streams across multiple Flussonic servers, view edge bandwidth
- Add `data-testid="new-stream-modal"` to the streams modal (testing-agent suggestion)
- Add `chart-*` testids on the /stats page
- Catch `bson.errors.InvalidId` in `get_current_user` to return 401 on malformed JWT subs
- Migrate from `@app.on_event` to FastAPI lifespan handlers
- Set cookie `secure=True` when behind HTTPS (env-driven)

**P2 (features)**
- Backend refactor (P2 DONE 2026-06-26): server.py 1097→110 lines (-90%) across deps.py/scope.py/models.py + 9 router modules. flussonic.py 1320→983 lines (-25%) via services/ split (branding/server_limits/pushes/hardware). Further service splits (streams/monitor/config/sessions) deferred — current state is fully maintainable.
- Stream detail page with embedded HLS preview — DONE 2026-06-26 (route `/streams/:name` + clickable name in list)
- DVR archive timeline browser
- Audit log persisted in MongoDB
- Webhooks / SSE push for sessions instead of polling

## What's Been Implemented (2026-07-01)
- ✅ **"Test source" button in Stream Wizard** — new `POST /api/streams/test-source` endpoint runs a best-effort reachability probe:
  - `http(s)://` → real GET with 5s timeout, reports status + latency
  - `rtmp/rtmps/rtsp://` → TCP socket probe (default ports 1935/443/554), reports latency
  - `srt://` → advisory message (UDP not testable)
  - `udp://`, `publish://`, `file://` → skipped with clear message
  - DNS failures / timeouts / connection refused → red "Cannot reach" with class name
  - Frontend: green ✓ / red ✗ pill next to the button + live URL preview. Auto-clears when the URL changes.
- ✅ **Brand name changed to "amixpanel"** via `/api/branding` PATCH (stored in Mongo).
- ✅ **Nginx source type in Stream Wizard** — New card "Nginx" alongside SRT/RTMP/HLS with a nginx-rtmp ⇄ nginx HLS toggle. Fields: host, port (default 1935 for rtmp / 80 for hls), app (default live/hls), stream key. Auto-builds `rtmp://host[:port]/app/key` or `http://host[:port]/app/key.m3u8` and posts it to Flussonic as the stream source. Verified UI end-to-end.
- ✅ Secure embeddable HLS player (`/api/embed/{token}`) fully working:
  - Fixed 500 → now proxies `/{stream}/index.m3u8` from Flussonic host (base URL only, bypassing `/streamer/api/v3` API path)
  - Bumped httpx timeout to 30s (Flussonic cold-start can take 5-10s for the first playlist)
  - Graceful upstream failure handling: `httpx.TimeoutException` → 504, `httpx.RequestError` → 502 (no more raw 500s)
  - Segment sub-playlists (`tracks-v1a1/mono.ts.m3u8`) also rewritten so viewers only ever hit `/api/embed/{token}/seg/{b64}`
  - Verified end-to-end: playlist HTTP 200, sub-playlist HTTP 200, `.ts` segment HTTP 200 (2 MB delivered), iframe player renders with hls.js on `QhuboTv`

## Next Tasks
- CDN Multi-server (Origin + Edges) — P1
