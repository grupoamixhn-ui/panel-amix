#!/usr/bin/env bash
# ==============================================================================
#  Flussonic Admin Panel — native installer
#  Supports: Ubuntu 22.04 / 24.04, Debian 11 / 12, AlmaLinux 8 / 9 / 10,
#            RockyLinux 8 / 9 / 10, RHEL 8 / 9
#
#  Tested on bare-metal, VPS (DigitalOcean / Vultr / Hetzner / Contabo) and
#  containers (LXC). Detects OS via /etc/os-release and adapts package manager,
#  Node.js + MongoDB repos, firewall (ufw / firewalld), and SELinux booleans /
#  port labels automatically.
#
#  Default: panel runs on https://<ip>:8080 with a self-signed certificate.
#
#  Usage:
#    sudo bash install.sh                              # https://<ip>:8080 (self-signed)
#    sudo bash install.sh --domain panel.example.com   # https + Let's Encrypt (port 443)
#    sudo bash install.sh --port 9443                  # custom https port (self-signed)
#    sudo bash install.sh --no-ssl                     # plain http on $port (default 8080)
#    sudo bash install.sh --no-mongo                   # skip MongoDB install (already running)
#    sudo bash install.sh --source-dir /path/to/code   # use code from this dir instead of script dir
#    sudo bash install.sh --admin-email me@me.com      # custom admin email
#    sudo bash install.sh --admin-password "S3cret!"   # fix admin password (else auto-generated)
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
LISTEN_PORT="8080"
USE_SSL="1"            # 1 = self-signed cert; 0 = plain HTTP; "letsencrypt" = via certbot
ADMIN_EMAIL="admin@localhost"
ADMIN_PASSWORD_OVERRIDE=""
INSTALL_MONGO="1"
PUBLIC_URL=""           # e.g. https://amix.hn/panel-amix/video — overrides DOMAIN+path
BASE_PATH=""            # auto-derived from PUBLIC_URL, e.g. /panel-amix/video
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ---------- args --------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)           DOMAIN="$2"; shift 2 ;;
    --port)             LISTEN_PORT="$2"; shift 2 ;;
    --no-ssl)           USE_SSL="0"; shift ;;
    --admin-email)      ADMIN_EMAIL="$2"; shift 2 ;;
    --admin-password)   ADMIN_PASSWORD_OVERRIDE="$2"; shift 2 ;;
    --no-mongo)         INSTALL_MONGO="0"; shift ;;
    --source-dir)       SOURCE_DIR="$2"; shift 2 ;;
    --public-url)       PUBLIC_URL="$2"; shift 2 ;;
    -h|--help)          sed -n '2,22p' "$0"; exit 0 ;;
    *)                  die "Unknown option: $1" ;;
  esac
done

# Parse PUBLIC_URL → DOMAIN + BASE_PATH so the panel can live under a subpath
# (e.g. https://amix.hn/panel-amix/video). When set, switches automatically to
# Let's Encrypt for SSL on the parsed domain.
if [[ -n "$PUBLIC_URL" ]]; then
  PUBLIC_URL="${PUBLIC_URL%/}"  # strip trailing slash
  proto="${PUBLIC_URL%%://*}"
  rest="${PUBLIC_URL#*://}"
  DOMAIN="${rest%%/*}"
  if [[ "$rest" == "$DOMAIN" ]]; then
    BASE_PATH=""
  else
    BASE_PATH="/${rest#*/}"
  fi
  [[ "$proto" == "https" ]] && USE_SSL="letsencrypt" || USE_SSL="0"
fi

# --domain switches HTTPS to Let's Encrypt (handled after nginx setup)
if [[ -n "$DOMAIN" ]]; then
  USE_SSL="letsencrypt"
fi

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
  # RHEL family (AlmaLinux/Rocky/RHEL/CentOS): enable EPEL + CRB/PowerTools so
  # certbot, python3-certbot-nginx and headers required by some pip wheels are
  # available. These commands are idempotent.
  RHEL_MAJOR="$(rpm -E %rhel 2>/dev/null || echo '')"
  dnf install -y -q dnf-plugins-core >/dev/null 2>&1 || true
  dnf install -y -q epel-release >/dev/null 2>&1 || \
    dnf install -y -q "https://dl.fedoraproject.org/pub/epel/epel-release-latest-${RHEL_MAJOR:-9}.noarch.rpm" >/dev/null 2>&1 || true
  # CodeReady Builder / PowerTools (name varies per OS major)
  case "$RHEL_MAJOR" in
    8) dnf config-manager --set-enabled powertools >/dev/null 2>&1 || \
       dnf config-manager --set-enabled PowerTools >/dev/null 2>&1 || true ;;
    9|10) dnf config-manager --set-enabled crb >/dev/null 2>&1 || true ;;
  esac

  # Pick the right Python 3.11 package name: RHEL 9/10 ship `python3.11`,
  # AlmaLinux/Rocky 8 ship `python3.11` too (since 8.6) but EOL CentOS 8 needs python39.
  PY_PKG="python3.11 python3.11-devel"
  if ! dnf list --available python3.11 >/dev/null 2>&1 && \
     ! dnf list --installed python3.11 >/dev/null 2>&1; then
    PY_PKG="python3 python3-devel"
  fi

  dnf install -y -q \
    ca-certificates curl gnupg2 \
    nginx rsync openssl firewalld policycoreutils-python-utils \
    $PY_PKG python3-pip \
    gcc gcc-c++ make git redhat-rpm-config
  # symlink python3.11 if available so the rest of the script can rely on it
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
    # Disable the distro 'nodejs' module if enabled; otherwise NodeSource
    # packages collide with RHEL's module-based nodejs (typical on AlmaLinux/Rocky 8/9).
    dnf module reset -y nodejs >/dev/null 2>&1 || true
    dnf module disable -y nodejs >/dev/null 2>&1 || true
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
      # MongoDB 7 has native repos for noble + bookworm now; keep mapping safe.
      case "$CODENAME" in
        noble|jammy|focal) MONGO_CODENAME="$CODENAME" ;;
        bookworm|bullseye) MONGO_CODENAME="$CODENAME" ;;
        *)                 MONGO_CODENAME="$CODENAME" ;;
      esac
      if [[ "$ID" == "ubuntu" ]]; then
        echo "deb [arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg] https://repo.mongodb.org/apt/ubuntu $MONGO_CODENAME/mongodb-org/7.0 multiverse" > /etc/apt/sources.list.d/mongodb-org-7.0.list
      else
        echo "deb [arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg] https://repo.mongodb.org/apt/debian $MONGO_CODENAME/mongodb-org/7.0 main" > /etc/apt/sources.list.d/mongodb-org-7.0.list
      fi
      apt-get update -qq
      apt-get install -y -qq mongodb-org
    else
      # MongoDB 7 ships per-major-version repos for RHEL 8 / 9. RHEL 10 isn't
      # supported yet (Feb 2026) — fall back to RHEL 9 packages which install
      # fine on AlmaLinux/Rocky 10 thanks to ABI compatibility.
      MONGO_RHEL_MAJOR="${RHEL_MAJOR:-9}"
      case "$MONGO_RHEL_MAJOR" in
        8|9) : ;;
        *)   MONGO_RHEL_MAJOR=9 ;;
      esac
      cat > /etc/yum.repos.d/mongodb-org-7.0.repo <<EOF
[mongodb-org-7.0]
name=MongoDB Repository
baseurl=https://repo.mongodb.org/yum/redhat/${MONGO_RHEL_MAJOR}/mongodb-org/7.0/x86_64/
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
# When deploying under a subpath (--public-url https://host/sub/path), the React
# bundle and the API requests all live under that prefix. PUBLIC_URL controls
# the static asset paths in index.html; REACT_APP_BACKEND_URL is read by the
# axios client; PUBLIC_URL_FULL goes into BrowserRouter basename via index.html
# meta tag (handled inside React).
if [[ -n "$BASE_PATH" ]]; then
  REACT_BACKEND_URL="$PUBLIC_URL"
  REACT_PUBLIC_URL="$BASE_PATH"
elif [[ -n "$DOMAIN" ]]; then
  REACT_BACKEND_URL=""
  REACT_PUBLIC_URL=""
else
  REACT_BACKEND_URL=""
  REACT_PUBLIC_URL=""
fi
cat > "$APP_DIR/frontend/.env" <<EOF
REACT_APP_BACKEND_URL=$REACT_BACKEND_URL
PUBLIC_URL=$REACT_PUBLIC_URL
WDS_SOCKET_PORT=0
EOF
( cd "$APP_DIR/frontend" && yarn install --silent --frozen-lockfile 2>/dev/null || yarn install --silent )
( cd "$APP_DIR/frontend" && PUBLIC_URL="$REACT_PUBLIC_URL" yarn build 2>&1 | tail -3 )
[[ -d "$APP_DIR/frontend/build" ]] || die "Frontend build failed — no build/ directory produced"
ok "frontend bundle in $APP_DIR/frontend/build"

# ---------- secrets + .env ----------------------------------------------------
title "8/8  Configuring services"

# Define SSL paths up-front so the backend .env can reference them even when
# --no-ssl was passed (paths are still written; only used by Nginx when USE_SSL=1).
SSL_CERT_DIR="/etc/flussonic-admin/ssl"
SSL_CERT="$SSL_CERT_DIR/cert.pem"
SSL_KEY="$SSL_CERT_DIR/key.pem"

ENV_FILE="$APP_DIR/backend/.env"
if [[ -f "$ENV_FILE" ]] && grep -q "^JWT_SECRET=" "$ENV_FILE"; then
  # Preserve existing config (idempotent re-run / upgrade)
  ok "preserving existing $ENV_FILE"
  ADMIN_PASSWORD="$(grep -E '^ADMIN_PASSWORD=' "$ENV_FILE" | cut -d= -f2- || echo '(see existing .env)')"
  ADMIN_EMAIL="$(grep -E '^ADMIN_EMAIL=' "$ENV_FILE" | cut -d= -f2- || echo "$ADMIN_EMAIL")"
  ENV_REUSED=1
else
  JWT_SECRET="$(openssl rand -hex 32)"
  if [[ -n "$ADMIN_PASSWORD_OVERRIDE" ]]; then
    ADMIN_PASSWORD="$ADMIN_PASSWORD_OVERRIDE"
  else
    ADMIN_PASSWORD="$(openssl rand -base64 14 | tr -d '+/=' | cut -c1-16)"
  fi
  cat > "$ENV_FILE" <<EOF
MONGO_URL=mongodb://127.0.0.1:27017
DB_NAME=flussonic_admin
JWT_SECRET=$JWT_SECRET
JWT_TTL_HOURS=72
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD
CORS_ORIGINS=*
SSL_CERT_PATH=$SSL_CERT
SSL_KEY_PATH=$SSL_KEY
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
# hardening — relaxed so the backend can invoke its sudoers-allowed helpers
# (flussonic-admin-ssl-helper, flussonic-admin-update, nginx -s reload, certbot).
# Setting NoNewPrivileges=yes here would block sudo from elevating to root.
NoNewPrivileges=no
ProtectSystem=no
ProtectHome=yes
PrivateTmp=yes
# Spool dir for update tarballs uploaded via the panel.
RuntimeDirectoryMode=0750
ReadWritePaths=$APP_DIR -/var/lib/flussonic-admin -/etc/letsencrypt
# systemd creates this dir automatically with the right owner (overrides for legacy installs)
StateDirectory=flussonic-admin
StateDirectoryMode=0750

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
# Pre-create the state dirs (systemd will also create them via StateDirectory= but
# legacy unit files won't have that directive — be defensive).
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 /var/lib/flussonic-admin
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 /var/lib/flussonic-admin/updates
systemctl enable --now ${SERVICE_NAME} >/dev/null
sleep 2
if ! systemctl is-active --quiet ${SERVICE_NAME}; then
  warn "Backend did not start — printing logs:"
  journalctl -u ${SERVICE_NAME} --no-pager -n 30 || true
  die "Backend service failed"
fi
ok "backend service running on 127.0.0.1:8001"

# ---------- self-signed certificate (when no domain provided) -----------------
if [[ "$USE_SSL" == "1" ]]; then
  mkdir -p "$SSL_CERT_DIR"
  if [[ ! -f "$SSL_CERT" || ! -f "$SSL_KEY" ]]; then
    log "Generating self-signed TLS certificate (10 years validity)"
    openssl req -x509 -nodes -newkey rsa:2048 \
      -keyout "$SSL_KEY" -out "$SSL_CERT" \
      -days 3650 -subj "/CN=$(hostname -f 2>/dev/null || hostname)" \
      -addext "subjectAltName=DNS:$(hostname),IP:127.0.0.1" 2>/dev/null
    chmod 600 "$SSL_KEY"
    ok "self-signed cert in $SSL_CERT_DIR"
  else
    ok "reusing existing self-signed cert in $SSL_CERT_DIR"
  fi
  # Make the cert dir readable by the backend user so /api/ssl/upload can rewrite it.
  chown -R root:"$APP_USER" "$SSL_CERT_DIR" 2>/dev/null || true
  chmod 750 "$SSL_CERT_DIR"
  chmod 640 "$SSL_CERT" "$SSL_KEY" 2>/dev/null || true
fi

# ---------- sudoers helper for SSL & nginx reload ----------------------------
SSL_HELPER="/usr/local/bin/flussonic-admin-reload-ssl"
cat > "$SSL_HELPER" <<EOF
#!/usr/bin/env bash
# Helper that the panel calls (with sudo) to install a new cert + reload nginx.
# Args: \$1 = source cert path, \$2 = source key path
set -e
CERT_SRC="\$1"; KEY_SRC="\$2"
[[ -f "\$CERT_SRC" && -f "\$KEY_SRC" ]] || exit 2
install -m 0644 "\$CERT_SRC" "$SSL_CERT"
install -m 0600 "\$KEY_SRC"  "$SSL_KEY"
nginx -t && nginx -s reload
EOF
chmod 755 "$SSL_HELPER"

# Spool directory for update tarballs uploaded through the panel (also created
# earlier near `systemctl enable --now` — kept here for idempotency on re-runs).
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 /var/lib/flussonic-admin/updates

# ---------- update helper (panel self-update via sudoers) --------------------
UPDATE_HELPER="/usr/local/bin/flussonic-admin-update"
if [[ -f "$SOURCE_DIR/install/flussonic-admin-update.sh" ]]; then
  install -m 0755 "$SOURCE_DIR/install/flussonic-admin-update.sh" "$UPDATE_HELPER"
  ok "update helper installed → $UPDATE_HELPER"
fi

# ---------- password reset CLI helper (root-only, no sudoers needed) ----------
RESET_HELPER="/usr/local/bin/flussonic-admin-reset-password"
if [[ -f "$SOURCE_DIR/install/flussonic-admin-reset-password.sh" ]]; then
  install -m 0750 -o root -g root "$SOURCE_DIR/install/flussonic-admin-reset-password.sh" "$RESET_HELPER"
  ok "password reset CLI installed → $RESET_HELPER (run with sudo)"
fi

SUDOERS_FILE="/etc/sudoers.d/flussonic-admin"
cat > "$SUDOERS_FILE" <<EOF
# Allow the backend service to manage its own TLS cert and reload nginx without password.
$APP_USER ALL=(root) NOPASSWD: $SSL_HELPER
$APP_USER ALL=(root) NOPASSWD: /usr/sbin/nginx -s reload
$APP_USER ALL=(root) NOPASSWD: /usr/sbin/nginx -t
$APP_USER ALL=(root) NOPASSWD: /usr/bin/certbot
$APP_USER ALL=(root) NOPASSWD: $UPDATE_HELPER *
EOF
chmod 440 "$SUDOERS_FILE"
visudo -c -f "$SUDOERS_FILE" >/dev/null && ok "sudoers helper installed (SSL + panel updates)"

# Record current VERSION (used by /api/updates/status)
if [[ -f "$SOURCE_DIR/VERSION" ]]; then
  cp -f "$SOURCE_DIR/VERSION" "$APP_DIR/VERSION"
fi

# ---------- nginx site --------------------------------------------------------
NGINX_SITE_NAME="flussonic-admin"
SERVER_NAME_LINE="server_name _;"
[[ -n "$DOMAIN" ]] && SERVER_NAME_LINE="server_name $DOMAIN;"

# Build the location blocks. When BASE_PATH is set the panel lives under a sub-path
# (e.g. https://amix.hn/panel-amix/video) — every public URL is prefixed and the
# SPA needs a regex alias so React Router catches all sub-routes.
if [[ -n "$BASE_PATH" ]]; then
  PANEL_LOCATIONS=$(cat <<NGINX
    # API mounted under the public sub-path: $BASE_PATH/api/* → backend
    location ${BASE_PATH}/api/ {
        proxy_pass http://127.0.0.1:8001/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Prefix ${BASE_PATH};
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }

    # Cache static build assets
    location ~* ^${BASE_PATH}/static/.+\.(?:js|css|woff2?|ttf|svg|png|jpg|jpeg|gif|ico)\$ {
        alias $APP_DIR/frontend/build\$request_uri;
        expires 30d;
        add_header Cache-Control "public, max-age=2592000, immutable";
        try_files \$uri =404;
    }

    # SPA — strip the sub-path prefix and serve from build/
    location ${BASE_PATH}/ {
        alias $APP_DIR/frontend/build/;
        try_files \$uri \$uri/ ${BASE_PATH}/index.html;
    }

    # Redirect bare prefix without trailing slash → with slash
    location = ${BASE_PATH} {
        return 301 ${BASE_PATH}/;
    }
NGINX
)
else
  PANEL_LOCATIONS=$(cat <<NGINX
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
    location / {
        try_files \$uri \$uri/ /index.html;
    }
    location ~* \.(?:js|css|woff2?|ttf|svg|png|jpg|jpeg|gif|ico)\$ {
        expires 30d;
        add_header Cache-Control "public, max-age=2592000, immutable";
    }
NGINX
)
fi

if [[ "$USE_SSL" == "1" ]]; then
  # HTTPS with self-signed cert
  cat > /tmp/${NGINX_SITE_NAME}.conf <<EOF
server {
    listen $LISTEN_PORT ssl;
    listen [::]:$LISTEN_PORT ssl;
    $SERVER_NAME_LINE

    ssl_certificate     $SSL_CERT;
    ssl_certificate_key $SSL_KEY;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    client_max_body_size 64m;
    root $APP_DIR/frontend/build;
    index index.html;

$PANEL_LOCATIONS
}
EOF
else
  # Plain HTTP (--no-ssl or --domain triggers Let's Encrypt path below which rewrites this)
  cat > /tmp/${NGINX_SITE_NAME}.conf <<EOF
server {
    listen $LISTEN_PORT;
    listen [::]:$LISTEN_PORT;
    $SERVER_NAME_LINE

    client_max_body_size 64m;
    root $APP_DIR/frontend/build;
    index index.html;

$PANEL_LOCATIONS
}
EOF
fi

if [[ "$PKG_FAMILY" == "deb" ]]; then
  mv /tmp/${NGINX_SITE_NAME}.conf /etc/nginx/sites-available/${NGINX_SITE_NAME}.conf
  ln -sf /etc/nginx/sites-available/${NGINX_SITE_NAME}.conf /etc/nginx/sites-enabled/${NGINX_SITE_NAME}.conf
  rm -f /etc/nginx/sites-enabled/default
else
  mv /tmp/${NGINX_SITE_NAME}.conf /etc/nginx/conf.d/${NGINX_SITE_NAME}.conf
  # disable default site if any
  [[ -f /etc/nginx/nginx.conf ]] && sed -i '/server {/,/^}/d' /etc/nginx/conf.d/default.conf 2>/dev/null || true
fi

# SELinux: allow nginx to proxy + permit non-standard listen ports
if command -v getenforce >/dev/null && [[ "$(getenforce)" == "Enforcing" ]]; then
  setsebool -P httpd_can_network_connect 1 2>/dev/null || true
  # Add custom LISTEN_PORT to http_port_t if it's not already there.
  if command -v semanage >/dev/null; then
    if ! semanage port -l 2>/dev/null | awk '/^http_port_t/ {print $0}' | grep -qw "$LISTEN_PORT"; then
      semanage port -a -t http_port_t -p tcp "$LISTEN_PORT" 2>/dev/null || \
      semanage port -m -t http_port_t -p tcp "$LISTEN_PORT" 2>/dev/null || true
    fi
  fi
fi

nginx -t >/dev/null
systemctl enable --now nginx >/dev/null
systemctl reload nginx
ok "nginx serving on port $LISTEN_PORT"

# ---------- firewall ----------------------------------------------------------
if [[ "$PKG_FAMILY" == "deb" ]] && command -v ufw >/dev/null; then
  if ufw status | grep -q "Status: active"; then
    ufw allow "$LISTEN_PORT/tcp" >/dev/null || true
    if [[ -n "$DOMAIN" ]]; then
      ufw allow 80/tcp  >/dev/null || true   # certbot HTTP-01 challenge
      ufw allow 443/tcp >/dev/null || true
    fi
  fi
elif command -v firewall-cmd >/dev/null; then
  systemctl enable --now firewalld >/dev/null 2>&1 || true
  if systemctl is-active --quiet firewalld; then
    firewall-cmd --permanent --add-port="${LISTEN_PORT}/tcp" >/dev/null 2>&1 || true
    if [[ -n "$DOMAIN" ]]; then
      firewall-cmd --permanent --add-service=http  >/dev/null 2>&1 || true
      firewall-cmd --permanent --add-service=https >/dev/null 2>&1 || true
    fi
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
elif [[ "$USE_SSL" == "1" ]]; then
  if [[ "$LISTEN_PORT" == "443" ]]; then PANEL_URL="https://$PUBLIC_IP"; else PANEL_URL="https://$PUBLIC_IP:$LISTEN_PORT"; fi
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

printf "\n  ${C_BLD}Forgot it later?${C_RST}  Run on this VPS:\n"
printf "     ${C_BLD}sudo flussonic-admin-reset-password${C_RST}\n"

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
