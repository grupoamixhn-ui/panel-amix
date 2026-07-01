#!/usr/bin/env bash
# Remove the amixpanel installed by install.sh
set -euo pipefail

APP_DIR="/opt/amixpanel"
APP_USER="amixpanel"
SERVICE_NAME="amixpanel"
NGINX_SITE_NAME="amixpanel"

C_GRN=$'\033[32m'; C_YLW=$'\033[33m'; C_RST=$'\033[0m'

[[ $EUID -eq 0 ]] || { echo "Run as root (sudo bash $0)"; exit 1; }

PURGE_DB="0"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge-db) PURGE_DB="1"; shift ;;
    -h|--help)
      cat <<EOF
Usage: sudo bash uninstall.sh [--purge-db]

  --purge-db   Also drop the 'flussonic_admin' MongoDB database (irreversible)

By default the MongoDB server itself is left running and the database is
preserved so you can reinstall without losing data.
EOF
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

echo "» Stopping & removing systemd service"
systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
systemctl disable "${SERVICE_NAME}" 2>/dev/null || true
rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload || true

echo "» Removing nginx site"
rm -f "/etc/nginx/sites-enabled/${NGINX_SITE_NAME}.conf" \
      "/etc/nginx/sites-available/${NGINX_SITE_NAME}.conf" \
      "/etc/nginx/conf.d/${NGINX_SITE_NAME}.conf"
if command -v nginx >/dev/null && nginx -t >/dev/null 2>&1; then
  systemctl reload nginx || true
fi

if [[ "$PURGE_DB" == "1" ]] && command -v mongosh >/dev/null; then
  echo "» Dropping MongoDB database 'flussonic_admin'"
  mongosh --quiet --eval 'db.getSiblingDB("flussonic_admin").dropDatabase()' || true
fi

echo "» Removing $APP_DIR"
rm -rf "$APP_DIR"

echo "» Removing user $APP_USER"
userdel "$APP_USER" 2>/dev/null || true

printf "${C_GRN}✓ Uninstall complete.${C_RST}\n"
if [[ "$PURGE_DB" != "1" ]]; then
  printf "${C_YLW}ℹ MongoDB and the database are still installed. Use --purge-db next time to drop the DB.${C_RST}\n"
fi
