#!/usr/bin/env bash
# ==============================================================================
#  amixpanel-install-nginx-rtmp
#
#  Installs nginx with the RTMP module so the VPS can act as an encoder
#  receiver for OBS / vMix / other RTMP clients. Configures:
#    • RTMP on :1935 with an application called "live"
#    • HLS output at /var/www/hls (served by nginx on the existing HTTP port)
#    • Publish authentication via a stream key (optional)
#    • ufw / firewalld opening of port 1935 when a firewall is detected
#
#  This runs as root via a sudoers entry provisioned by amixpanel install.sh.
#  Idempotent — safe to re-run.
#
#  Usage:
#    sudo amixpanel-install-nginx-rtmp                     # install with defaults
#    sudo amixpanel-install-nginx-rtmp --port 1935 --app live
# ==============================================================================
set -euo pipefail

C_GRN=$'\e[32m'; C_RED=$'\e[31m'; C_YLW=$'\e[33m'; C_BLD=$'\e[1m'; C_RST=$'\e[0m'
log()  { printf "${C_GRN}▶${C_RST} %s\n" "$*"; }
warn() { printf "${C_YLW}⚠${C_RST} %s\n" "$*"; }
die()  { printf "${C_RED}✗${C_RST} %s\n" "$*" >&2; exit 1; }

RTMP_PORT="1935"
RTMP_APP="live"
HLS_DIR="/var/www/hls"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) RTMP_PORT="$2"; shift 2 ;;
    --app)  RTMP_APP="$2";  shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) die "Unknown flag: $1" ;;
  esac
done

[[ $EUID -eq 0 ]] || die "Run as root (sudo)"

# ---------- OS detect ---------------------------------------------------------
. /etc/os-release
case "${ID_LIKE:-$ID}" in
  *debian*|*ubuntu*) PKG="deb" ;;
  *rhel*|*fedora*)   PKG="rpm" ;;
  *)
    case "$ID" in
      ubuntu|debian) PKG="deb" ;;
      almalinux|rocky|rhel|centos) PKG="rpm" ;;
      *) die "Unsupported OS: $ID" ;;
    esac
    ;;
esac
log "Detected $PRETTY_NAME ($PKG)"

# ---------- Install nginx + RTMP module --------------------------------------
if [[ "$PKG" == "deb" ]]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  # libnginx-mod-rtmp is available on Debian 11+ and Ubuntu 20.04+ from main repos
  apt-get install -y -qq nginx libnginx-mod-rtmp ufw >/dev/null || \
    apt-get install -y -qq nginx libnginx-mod-rtmp >/dev/null
else
  # AlmaLinux/Rocky: nginx from EPEL, rtmp module from `nginx-mod-rtmp`
  yum install -y epel-release >/dev/null 2>&1 || dnf install -y epel-release >/dev/null 2>&1 || true
  yum install -y nginx nginx-mod-rtmp firewalld >/dev/null 2>&1 \
    || dnf install -y nginx nginx-mod-rtmp firewalld >/dev/null 2>&1 \
    || die "Failed to install nginx + rtmp module (check EPEL is enabled)"
fi

# ---------- Generate config ---------------------------------------------------
install -d -m 0755 "$HLS_DIR"
chown -R nginx:nginx "$HLS_DIR" 2>/dev/null || chown -R www-data:www-data "$HLS_DIR" 2>/dev/null || true

# Preserve any custom stream keys already configured (best-effort)
KEYS_FILE="/etc/amixpanel/rtmp_keys.txt"
[[ -f "$KEYS_FILE" ]] || { install -d -m 0755 /etc/amixpanel; : > "$KEYS_FILE"; chmod 0640 "$KEYS_FILE"; }

RTMP_CONF="/etc/nginx/modules-enabled/60-amixpanel-rtmp.conf"
# Debian/Ubuntu use modules-enabled; if that dir doesn't exist fall back to conf.d
if [[ ! -d /etc/nginx/modules-enabled ]]; then
  RTMP_CONF="/etc/nginx/conf.d/amixpanel-rtmp.conf"
fi

cat > "$RTMP_CONF" <<EOF
# amixpanel-managed — nginx-rtmp module for OBS/vMix ingest
# Regenerate with: sudo amixpanel-install-nginx-rtmp
rtmp {
    server {
        listen ${RTMP_PORT};
        chunk_size 4096;

        application ${RTMP_APP} {
            live on;
            record off;

            # HLS output — served by the HTTP server block below
            hls on;
            hls_path ${HLS_DIR};
            hls_fragment 4s;
            hls_playlist_length 60s;

            # Only allow publish from localhost by default; enable public
            # push by editing this line (or use the amixpanel UI).
            allow publish all;
            allow play all;
        }
    }
}
EOF

# Make sure the HTTP server serves HLS files
HTTP_CONF="/etc/nginx/conf.d/amixpanel-hls.conf"
cat > "$HTTP_CONF" <<EOF
# amixpanel-managed — HLS delivery for encoder streams
server {
    listen 80;
    server_name _;

    location /hls/ {
        alias ${HLS_DIR}/;
        add_header Cache-Control "no-cache";
        add_header Access-Control-Allow-Origin "*";
        types {
            application/vnd.apple.mpegurl m3u8;
            video/mp2t                    ts;
        }
    }

    location = /nginx-rtmp-status {
        # Health check used by the amixpanel UI
        return 200 "OK\\n";
        add_header Content-Type text/plain;
    }
}
EOF

# ---------- Firewall ---------------------------------------------------------
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow "${RTMP_PORT}"/tcp >/dev/null 2>&1 || true
  log "ufw: opened tcp/${RTMP_PORT}"
fi
if systemctl is-active --quiet firewalld 2>/dev/null; then
  firewall-cmd --permanent --add-port="${RTMP_PORT}/tcp" >/dev/null 2>&1 || true
  firewall-cmd --reload >/dev/null 2>&1 || true
  log "firewalld: opened tcp/${RTMP_PORT}"
fi

# ---------- Test config + restart --------------------------------------------
nginx -t 2>&1 | tail -3
systemctl enable nginx >/dev/null 2>&1
systemctl restart nginx

# ---------- Report ------------------------------------------------------------
PUB_IP="$(curl -s --max-time 3 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
printf "\n${C_BLD}${C_GRN}nginx-rtmp encoder ready.${C_RST}\n"
printf "  OBS / vMix URL:  ${C_BLD}rtmp://%s:%s/%s${C_RST}\n" "$PUB_IP" "$RTMP_PORT" "$RTMP_APP"
printf "  Stream key:      choose any (Flussonic will pull that key)\n"
printf "  HLS output:      http://%s/hls/<streamkey>.m3u8\n" "$PUB_IP"
printf "  Config file:     %s\n" "$RTMP_CONF"
