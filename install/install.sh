#!/usr/bin/env bash
# ==============================================================================
#  Flussonic Admin Panel — native installer
#  Supports: Ubuntu 22.04 / 24.04, Debian 11 / 12, AlmaLinux 8 / 9, RockyLinux 8 / 9
#
#  Usage:
#    sudo bash install.sh                              # local HTTP on port 80
#    sudo bash install.sh --domain panel.example.com   # + Let's Encrypt SSL
#    sudo bash install.sh --port 8080                  # listen on a non-standard port
#    sudo bash install.sh --no-mongo                   # skip MongoDB install (already running)
#    sudo bash install.sh --source-dir /path/to/code   # use code from this dir instead of script dir
#    sudo bash install.sh --admin-email me@me.com      # custom admin email
#
#  After install:
#    Panel URL, admin credentials and service status are printed at the end.
#    Logs:    journalctl -u flussonic-admin -f
#    Restart: systemctl restart flussonic-admin
# ==============================================================================
set -euo pipefail

# ---------- styling -----------------------------------------------------------
C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YLW=$'\033[33m'; C_BLU=$'\033[34m'; C_RST=$'\033[0m'; C_BLD=$'\033[1m'
log()    { printf "${C_BLU}»${C_RST} %s\n" "$*"; }
ok()     { printf "${C_GRN}✓${C_RST} %s\n" "$*"; }
warn()   { printf "${C_YLW}⚠${C_RST} %s\n" "$*"; }
die()    { printf "${C_RED}✗${C_RST} %s\n" "$*" >&2; exit 1; }
title()  { printf "\n${C_BLD}%s${C_RST}\n%s\n" "$*" "$(printf '%.0s─' {1..60})"; }

# ---------- defaults ----------------------------------------------------------
APP_DIR="/opt/flussonic-admin"
APP_USER="flussonic-admin"
SERVICE_NAME="flussonic-admin"
DOMAIN=""
LISTEN_PORT="80"
ADMIN_EMAIL="admin@localhost"
INSTALL_MONGO="1"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ---------- args --------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)         DOMAIN="$2"; shift 2 ;;
    --port)           LISTEN_PORT="$2"; shift 2 ;;
    --admin-email)    ADMIN_EMAIL="$2"; shift 2 ;;
    --no-mongo)       INSTALL_MONGO="0"; shift ;;
    --source-dir)     SOURCE_DIR="$2"; shift 2 ;;
    -h|--help)        sed -n '2,20p' "$0"; exit 0 ;;
    *)                die "Unknown option: $1" ;;
  esac
done

[[ $EUID -eq 0 ]] || die "Run as root (sudo bash $0)"

# ---------- detect OS ---------------------------------------------------------
. /etc/os-release
ID_LIKE_LOWER="${ID_LIKE:-$ID}"
case "$ID" in
  ubuntu|debian)     PKG_FAMILY="deb" ;;
  almalinux|rocky|rhel|centos)
                     PKG_FAMILY="rpm" ;;
  *)
    # last-chance check by id_like
    case "$ID_LIKE_LOWER" in
      *debian*|*ubuntu*) PKG_FAMILY="deb" ;;
      *rhel*|*fedora*)   PKG_FAMILY="rpm" ;;
      *) die "Unsupported OS: $ID. Supported: ubuntu, debian, almalinux, rocky" ;;
    esac
    ;;
esac
ARCH="$(uname -m)"
log "Detected $PRETTY_NAME ($PKG_FAMILY/$ARCH)"

# ---------- pre-flight --------------------------------------------------------
if [[ ! -d "$SOURCE_DIR/backend" ]] || [[ ! -d "$SOURCE_DIR/frontend" ]]; then
  die "Source dir '$SOURCE_DIR' does not contain backend/ and frontend/ directories.
Use --source-dir to point to the code root."
fi

# ---------- install system packages -------------------------------------------
title "1/8  Installing system packages"
if [[ "$PKG_FAMILY" == "deb" ]]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq \
    ca-certificates curl gnupg lsb-release software-properties-common \
    nginx rsync openssl ufw \
    python3 python3-venv python3-pip python3-dev \
    build-essential git
else
  dnf install -y -q \
    ca-certificates curl gnupg2 \
    nginx rsync openssl firewalld \
    python3.11 python3.11-devel python3-pip \
    gcc gcc-c++ make git || \
  dnf install -y -q \
    ca-certificates curl gnupg2 \
    nginx rsync openssl firewalld \
    python3 python3-devel python3-pip \
    gcc gcc-c++ make git
  # symlink python3.11 if available
  if command -v python3.11 >/dev/null; then ln -sf "$(command -v python3.11)" /usr/local/bin/python3.11; fi
fi
ok "system packages installed"

# ---------- Node.js 20 --------------------------------------------------------
title "2/8  Installing Node.js 20 + Yarn"
if ! command -v node >/dev/null || [[ "$(node -v | cut -dv -f2 | cut -d. -f1)" -lt 18 ]]; then
  if [[ "$PKG_FAMILY" == "deb" ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
    apt-get install -y -qq nodejs
  else
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - >/dev/null
    dnf install -y -q nodejs
  fi
fi
npm install -g --silent yarn >/dev/null 2>&1 || npm install -g yarn
ok "node $(node -v) / yarn $(yarn --version)"

# ---------- MongoDB 7 ---------------------------------------------------------
if [[ "$INSTALL_MONGO" == "1" ]]; then
  title "3/8  Installing MongoDB 7"
  if ! command -v mongod >/dev/null; then
    if [[ "$PKG_FAMILY" == "deb" ]]; then
      curl -fsSL https://pgp.mongodb.com/server-7.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg
      CODENAME="$(lsb_release -cs)"
      # Ubuntu 24.04 (noble) uses jammy repo for now
      case "$CODENAME" in
        noble) MONGO_CODENAME="jammy" ;;
        bookworm) MONGO_CODENAME="bookworm" ;;
        *) MONGO_CODENAME="$CODENAME" ;;
      esac
      if [[ "$ID" == "ubuntu" ]]; then
        echo "deb [arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg] https://repo.mongodb.org/apt/ubuntu $MONGO_CODENAME/mongodb-org/7.0 multiverse" > /etc/apt/sources.list.d/mongodb-org-7.0.list
      else
        echo "deb [arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg] https://repo.mongodb.org/apt/debian $MONGO_CODENAME/mongodb-org/7.0 main" > /etc/apt/sources.list.d/mongodb-org-7.0.list
      fi
      apt-get update -qq
      apt-get install -y -qq mongodb-org
    else
      cat > /etc/yum.repos.d/mongodb-org-7.0.repo <<'EOF'
[mongodb-org-7.0]
name=MongoDB Repository
baseurl=https://repo.mongodb.org/yum/redhat/$releasever/mongodb-org/7.0/x86_64/
gpgcheck=1
enabled=1
gpgkey=https://pgp.mongodb.com/server-7.0.asc
EOF
      dnf install -y -q mongodb-org
    fi
  fi
  systemctl enable --now mongod >/dev/null
  ok "MongoDB 7 running ($(systemctl is-active mongod))"
else
  warn "Skipping MongoDB install (--no-mongo)"
fi

# ---------- app user ----------------------------------------------------------
title "4/8  Creating application user"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi
ok "user $APP_USER"

# ---------- copy code ---------------------------------------------------------
title "5/8  Copying application code → $APP_DIR"
mkdir -p "$APP_DIR"
rsync -a --delete \
  --exclude '.git/' --exclude 'node_modules/' --exclude '.venv/' \
  --exclude '__pycache__/' --exclude '*.pyc' \
  --exclude 'frontend/build/' \
  --exclude 'test_reports/' --exclude '.emergent/' \
  "$SOURCE_DIR/backend" "$SOURCE_DIR/frontend" "$SOURCE_DIR/install" \
  "$APP_DIR/"
ok "code copied"

# ---------- backend venv + deps ----------------------------------------------
title "6/8  Building backend (Python venv)"
PY_BIN="$(command -v python3.11 || command -v python3)"
"$PY_BIN" -m venv "$APP_DIR/backend/.venv"
"$APP_DIR/backend/.venv/bin/pip" install --quiet --upgrade pip wheel
"$APP_DIR/backend/.venv/bin/pip" install --quiet -r "$APP_DIR/backend/requirements.txt"
ok "backend venv ready ($($APP_DIR/backend/.venv/bin/python --version))"

# ---------- frontend build ----------------------------------------------------
title "7/8  Building frontend (React production bundle)"
# Decide the public URL for the API. If a domain is set, it's https://domain;
# otherwise relative '' so the browser uses the same host/scheme it's loaded from.
if [[ -n "$DOMAIN" ]]; then
  REACT_BACKEND_URL=""   # relative — nginx serves both at same host
else
  REACT_BACKEND_URL=""
fi
cat > "$APP_DIR/frontend/.env" <<EOF
REACT_APP_BACKEND_URL=$REACT_BACKEND_URL
WDS_SOCKET_PORT=0
EOF
( cd "$APP_DIR/frontend" && yarn install --silent --frozen-lockfile 2>/dev/null || yarn install --silent )
( cd "$APP_DIR/frontend" && yarn build 2>&1 | tail -3 )
[[ -d "$APP_DIR/frontend/build" ]] || die "Frontend build failed — no build/ directory produced"
ok "frontend bundle in $APP_DIR/frontend/build"

# ---------- secrets + .env ----------------------------------------------------
title "8/8  Configuring services"
ENV_FILE="$APP_DIR/backend/.env"
if [[ -f "$ENV_FILE" ]] && grep -q "^JWT_SECRET=" "$ENV_FILE"; then
  # Preserve existing config (idempotent re-run / upgrade)
  ok "preserving existing $ENV_FILE"
  ADMIN_PASSWORD="$(grep -E '^ADMIN_PASSWORD=' "$ENV_FILE" | cut -d= -f2- || echo '(see existing .env)')"
  ADMIN_EMAIL="$(grep -E '^ADMIN_EMAIL=' "$ENV_FILE" | cut -d= -f2- || echo "$ADMIN_EMAIL")"
  ENV_REUSED=1
else
  JWT_SECRET="$(openssl rand -hex 32)"
  ADMIN_PASSWORD="$(openssl rand -base64 14 | tr -d '+/=' | cut -c1-16)"
  cat > "$ENV_FILE" <<EOF
MONGO_URL=mongodb://127.0.0.1:27017
DB_NAME=flussonic_admin
JWT_SECRET=$JWT_SECRET
JWT_TTL_HOURS=72
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD
CORS_ORIGINS=*
DEMO_MODE=false
EOF
  ENV_REUSED=0
fi
chmod 600 "$ENV_FILE"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# ---------- systemd unit ------------------------------------------------------
cat > /etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=Flussonic Admin Panel — backend API
After=network.target mongod.service
Wants=mongod.service

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/backend
EnvironmentFile=$APP_DIR/backend/.env
ExecStart=$APP_DIR/backend/.venv/bin/uvicorn server:app --host 127.0.0.1 --port 8001 --workers 2
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal
# hardening
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$APP_DIR
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now ${SERVICE_NAME} >/dev/null
sleep 2
if ! systemctl is-active --quiet ${SERVICE_NAME}; then
  warn "Backend did not start — printing logs:"
  journalctl -u ${SERVICE_NAME} --no-pager -n 30 || true
  die "Backend service failed"
fi
ok "backend service running on 127.0.0.1:8001"

# ---------- nginx site --------------------------------------------------------
NGINX_SITE_NAME="flussonic-admin"
SERVER_NAME_LINE="server_name _;"
[[ -n "$DOMAIN" ]] && SERVER_NAME_LINE="server_name $DOMAIN;"

cat > /tmp/${NGINX_SITE_NAME}.conf <<EOF
server {
    listen $LISTEN_PORT;
    listen [::]:$LISTEN_PORT;
    $SERVER_NAME_LINE

    client_max_body_size 64m;
    root $APP_DIR/frontend/build;
    index index.html;

    # backend API
    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }

    # SPA fallback
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # cache the build assets
    location ~* \.(?:js|css|woff2?|ttf|svg|png|jpg|jpeg|gif|ico)\$ {
        expires 30d;
        add_header Cache-Control "public, max-age=2592000, immutable";
    }
}
EOF

if [[ "$PKG_FAMILY" == "deb" ]]; then
  mv /tmp/${NGINX_SITE_NAME}.conf /etc/nginx/sites-available/${NGINX_SITE_NAME}.conf
  ln -sf /etc/nginx/sites-available/${NGINX_SITE_NAME}.conf /etc/nginx/sites-enabled/${NGINX_SITE_NAME}.conf
  rm -f /etc/nginx/sites-enabled/default
else
  mv /tmp/${NGINX_SITE_NAME}.conf /etc/nginx/conf.d/${NGINX_SITE_NAME}.conf
  # disable default site if any
  [[ -f /etc/nginx/nginx.conf ]] && sed -i '/server {/,/^}/d' /etc/nginx/conf.d/default.conf 2>/dev/null || true
fi

# SELinux: allow nginx to proxy
if command -v getenforce >/dev/null && [[ "$(getenforce)" == "Enforcing" ]]; then
  setsebool -P httpd_can_network_connect 1 2>/dev/null || true
fi

nginx -t >/dev/null
systemctl enable --now nginx >/dev/null
systemctl reload nginx
ok "nginx serving on port $LISTEN_PORT"

# ---------- firewall ----------------------------------------------------------
if [[ "$PKG_FAMILY" == "deb" ]] && command -v ufw >/dev/null; then
  if ufw status | grep -q "Status: active"; then
    ufw allow "$LISTEN_PORT/tcp" >/dev/null || true
    [[ -n "$DOMAIN" ]] && ufw allow 443/tcp >/dev/null || true
  fi
elif command -v firewall-cmd >/dev/null; then
  systemctl enable --now firewalld >/dev/null 2>&1 || true
  if systemctl is-active --quiet firewalld; then
    firewall-cmd --permanent --add-port="${LISTEN_PORT}/tcp" >/dev/null 2>&1 || true
    [[ -n "$DOMAIN" ]] && firewall-cmd --permanent --add-service=https >/dev/null 2>&1 || true
    firewall-cmd --reload >/dev/null 2>&1 || true
  fi
fi

# ---------- Let's Encrypt -----------------------------------------------------
if [[ -n "$DOMAIN" ]]; then
  title "Optional: Let's Encrypt SSL for $DOMAIN"
  if [[ "$PKG_FAMILY" == "deb" ]]; then
    apt-get install -y -qq certbot python3-certbot-nginx
  else
    dnf install -y -q certbot python3-certbot-nginx
  fi
  certbot --nginx -d "$DOMAIN" -n --agree-tos -m "$ADMIN_EMAIL" --redirect || \
    warn "certbot failed — panel still reachable via http://$DOMAIN. Re-run: certbot --nginx -d $DOMAIN"
fi

# ---------- done --------------------------------------------------------------
PUBLIC_IP="$(curl -fsS --max-time 3 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
if [[ -n "$DOMAIN" ]]; then
  PANEL_URL="https://$DOMAIN"
else
  if [[ "$LISTEN_PORT" == "80" ]]; then PANEL_URL="http://$PUBLIC_IP"; else PANEL_URL="http://$PUBLIC_IP:$LISTEN_PORT"; fi
fi

cat <<EOF

${C_GRN}════════════════════════════════════════════════════════════════${C_RST}
${C_GRN}${C_BLD}  Flussonic Admin Panel — install complete${C_RST}
${C_GRN}════════════════════════════════════════════════════════════════${C_RST}

  ${C_BLD}URL:${C_RST}       $PANEL_URL
  ${C_BLD}Login:${C_RST}     $ADMIN_EMAIL
  ${C_BLD}Password:${C_RST}  $ADMIN_PASSWORD
EOF

if [[ "$ENV_REUSED" == "1" ]]; then
  printf "\n  ${C_YLW}ℹ  Reused existing $APP_DIR/backend/.env — password unchanged.${C_RST}\n"
else
  printf "\n  ${C_YLW}⚠  Save this password now — it is only shown here.${C_RST}\n"
  printf "     Stored (bcrypt) in MongoDB; ADMIN_PASSWORD also lives in:\n"
  printf "        $APP_DIR/backend/.env  (root only)\n"
fi

cat <<EOF

  ${C_BLD}Service commands:${C_RST}
    systemctl status  ${SERVICE_NAME}
    systemctl restart ${SERVICE_NAME}
    journalctl -u     ${SERVICE_NAME} -f

  ${C_BLD}Update the panel later:${C_RST}
    cd $APP_DIR && sudo bash install/install.sh --source-dir <new code>

  ${C_BLD}Connect to your Flussonic Media Server:${C_RST}
    Open the panel → Settings → fill in Flussonic URL/user/password → Save.

EOF
