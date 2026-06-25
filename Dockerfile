# syntax=docker/dockerfile:1.7
# ──────────────────────────────────────────────────────────────────────────────
#  Flussonic Admin Panel — production image
#  • Stage 1: build the React frontend (Node 20)
#  • Stage 2: install the Python backend (slim)
#  • Stage 3: runtime — nginx (static SPA) + uvicorn (FastAPI) under supervisord
# ──────────────────────────────────────────────────────────────────────────────

ARG NODE_VERSION=20
ARG PYTHON_VERSION=3.11

# ─── 1) Frontend build ───────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/yarn.lock ./
RUN corepack enable && yarn install --frozen-lockfile --silent
COPY frontend/ ./
# Backend URL is empty → SPA calls /api on the same origin (handled by nginx)
RUN echo "REACT_APP_BACKEND_URL=" > .env && yarn build

# ─── 2) Backend deps ─────────────────────────────────────────────────────────
FROM python:${PYTHON_VERSION}-slim AS backend
WORKDIR /app/backend
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
    && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip wheel \
    && pip install --no-cache-dir -r requirements.txt
COPY backend/ ./

# ─── 3) Runtime ──────────────────────────────────────────────────────────────
FROM python:${PYTHON_VERSION}-slim AS runtime

# Runtime deps: nginx (SPA + reverse proxy) + supervisor + curl (healthcheck)
RUN apt-get update && apt-get install -y --no-install-recommends \
        nginx supervisor curl ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && rm /etc/nginx/sites-enabled/default

# Python deps from the backend stage (site-packages + binaries)
COPY --from=backend /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=backend /usr/local/bin/uvicorn /usr/local/bin/uvicorn
COPY --from=backend /usr/local/bin/gunicorn /usr/local/bin/gunicorn 2>/dev/null || true

# Application code
WORKDIR /app
COPY backend/  /app/backend/
COPY install/  /app/install/
COPY --from=frontend /build/build /app/frontend/build

# nginx site
COPY <<'NGINX' /etc/nginx/conf.d/flussonic-admin.conf
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 64m;
    root /app/frontend/build;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(?:js|css|woff2?|ttf|svg|png|jpg|jpeg|gif|ico)$ {
        expires 30d;
        add_header Cache-Control "public, max-age=2592000, immutable";
    }
}
NGINX

# supervisord — run nginx + uvicorn in one container
COPY <<'SUP' /etc/supervisor/conf.d/flussonic-admin.conf
[supervisord]
nodaemon=true
user=root
logfile=/dev/null
logfile_maxbytes=0
pidfile=/tmp/supervisord.pid

[program:nginx]
command=/usr/sbin/nginx -g "daemon off;"
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:uvicorn]
command=/usr/local/bin/uvicorn server:app --host 127.0.0.1 --port 8001 --workers 2
directory=/app/backend
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
SUP

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fsS http://127.0.0.1/api/auth/me -o /dev/null || curl -fsS http://127.0.0.1/ -o /dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]
