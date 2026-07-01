# amixpanel

> A modern, multi-tenant control plane for **Flussonic Media Server** — built
> as a NOC dashboard for streaming engineers, resellers and platform admins.

Manage SRT / RTMP / HLS streams, watch live viewers and bandwidth in real time,
hand out quota-capped sub-accounts to clients, and ship the whole stack to any
VPS with a single bash installer.

![Stack](https://img.shields.io/badge/stack-React%2019%20%2B%20FastAPI%20%2B%20MongoDB%207-0F172A?style=flat-square)
![Self-hosted](https://img.shields.io/badge/deployment-self--hosted-22C55E?style=flat-square)
![SRT](https://img.shields.io/badge/SRT-publish%20%2B%20play-D946EF?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

---

## ✨ What you get

| Area | Features |
|---|---|
| **Streams** | Wizard for SRT pull / SRT receive (`#!::r=name,m=publish`) / RTMP pull / RTMP receive / HLS pull / UDP / RTSP / File loop. Per-stream max bitrate, source timeout, publish password (RTMP). Live monitor modal (Recharts time-series for input/output bitrate + codecs). |
| **Sessions** | Real-time viewer list, filter by protocol, kick / inspect. |
| **NOC monitor** | Rolling 60-sample window of CPU / RAM / bandwidth-in / bandwidth-out / streams / viewers (3 s refresh) — reads from Flussonic `/streamer/api/v3/config`. |
| **Output URLs** | Per stream: HLS / HLS-LL / RTMP pull / SRT pull (viewers) **and** RTMP publish / SRT publish (encoders, OBS-friendly Server + Stream-ID split). |
| **RBAC** | Roles: `admin` / `reseller` / `client`. Resellers can create their own clients with **max streams**, **max concurrent viewers** and **expiry date**. Admins can create other admins from the Resellers tab. |
| **Branding** | Upload your logo, auto-extract primary + hover colors from it, customise brand name & tagline. |
| **Self-hosted installer** | Native bash installer for Ubuntu 22.04 / 24.04, Debian 11 / 12, AlmaLinux & Rocky 8 / 9 / 10. Builds Python venv + React production bundle + MongoDB 7 + nginx reverse proxy + systemd unit + optional Let's Encrypt. Downloadable tarball generated on-demand from inside the panel. |

---

## 🚀 One-command install on your VPS

```bash
curl -fsSL https://YOUR-PANEL/api/download/installer -o /tmp/amixpanel.tar.gz
cd /tmp && tar xzf amixpanel.tar.gz && cd amixpanel-*
sudo bash install/install.sh
```

Or with a public domain + free SSL:

```bash
sudo bash install/install.sh --domain panel.example.com --admin-email me@me.com
```

See **[install/README.md](install/README.md)** for every flag, day-2 ops and
troubleshooting.

---

## 🐳 Docker / Docker Compose

Prefer containers? The whole stack (panel + MongoDB) lives in
`docker-compose.yml`:

```bash
# 1. Generate secrets and put them in .env at the repo root
cat > .env <<EOF
JWT_SECRET=$(openssl rand -hex 32)
ADMIN_EMAIL=admin@flussonic.io
ADMIN_PASSWORD=$(openssl rand -base64 14 | tr -d '+/=' | cut -c1-16)
PANEL_PORT=80
EOF

# 2. Build and run
docker compose up -d --build

# 3. Tail logs
docker compose logs -f panel
```

The panel will be at `http://YOUR_HOST:80`, persistent data lives in the named
volume `mongo-data`. To stop and remove everything: `docker compose down`
(add `-v` to also wipe the database).

---

## 🧱 Architecture

```
┌─────────────────────────┐        ┌──────────────────────────┐
│  React 19 + Tailwind    │  /api  │  FastAPI                 │
│  (production build)     ├───────▶│  (uvicorn @ 127.0.0.1)   │
│   served by nginx       │        │  • JWT auth (httpOnly)   │
└─────────────────────────┘        │  • bcrypt passwords      │
                                   │  • httpx Flussonic proxy │
                                   └────────────┬─────────────┘
                                                │
                              ┌─────────────────┴────────────────┐
                              ▼                                  ▼
                   ┌────────────────────┐             ┌──────────────────────┐
                   │  MongoDB 7         │             │  Flussonic Media     │
                   │  • users           │             │  Server (external)   │
                   │  • config          │             │  /streamer/api/v3    │
                   │  • branding        │             └──────────────────────┘
                   └────────────────────┘
```

- **Frontend (`/frontend`)**: React 19, react-router 7, Recharts, hls.js, lucide-react, Tailwind, IBM Plex.
- **Backend (`/backend`)**: FastAPI, motor (async Mongo), httpx, PyJWT, bcrypt.
- **Installer (`/install`)**: pure bash, idempotent, OS-detecting.

---

## 🛠️ Local development

```bash
# Backend
cd backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in MONGO_URL, JWT_SECRET, ADMIN_*
uvicorn server:app --reload --port 8001

# Frontend (separate terminal)
cd frontend
yarn install
yarn start              # opens http://localhost:3000
```

Default seeded admin (from `backend/.env`):

```
email:    admin@flussonic.io
password: admin123        # change in .env, restart backend, it re-syncs
```

Then go to **Settings → Connection** and fill in your Flussonic URL, user,
password and public host.

---

## 🔌 Connecting to Flussonic

The panel never reads from `flussonic.conf` directly — it talks to
`/streamer/api/v3` over HTTP basic auth. Recommended `flussonic.conf` snippet:

```nginx
source_timeout 60;
max_sessions 400;

srt_publish {
  port 9998;
}
srt_play {
  port 9998;
}
```

The panel exposes encoder URLs in the standard SRT URI streamid format:

```
srt://YOUR_HOST:9998?streamid=#!::r=STREAM,m=publish
```

OBS / FFmpeg can also use the split form:

```
Server:    srt://YOUR_HOST:9998
Stream ID: #!::r=STREAM,m=publish
```

---

## 📦 Repo layout

```
/app
├── backend/             FastAPI app (server.py, flussonic.py) + tests/
├── frontend/            React 19 SPA (src/, public/)
├── install/             install.sh · uninstall.sh · make-release.sh · README.md
├── memory/              PRD.md  (test_credentials.md is gitignored)
└── README.md            ← you are here
```

---

## 🤝 Roadmap

- [ ] Multi-server CDN (Origin + Edges, geo-routing, load balancer)
- [ ] FFmpeg push command snippet next to each SRT/RTMP publish URL
- [ ] Audit log of admin actions persisted in MongoDB
- [ ] DVR archive timeline browser
- [ ] Webhooks / SSE for sessions instead of polling

---

## 📄 License

MIT — see [LICENSE](LICENSE) if present, otherwise free to fork and adapt.

---

Built with ❤️ on top of [Flussonic Media Server](https://flussonic.com/) and
[Emergent](https://emergent.sh/).
