#!/usr/bin/env bash
# ==============================================================================
#  flussonic-admin-reset-password — reset (or create) the admin user
#
#  Usage:
#    sudo flussonic-admin-reset-password
#    sudo flussonic-admin-reset-password admin@example.com NuevaPass123
#    sudo flussonic-admin-reset-password admin@example.com           # prompts for password
#
#  What it does:
#    1. Updates ADMIN_EMAIL + ADMIN_PASSWORD in /opt/flussonic-admin/backend/.env
#    2. Rewrites the bcrypt hash in MongoDB so the change takes effect immediately
#    3. Restarts the backend (idempotent re-seed on startup ensures consistency)
# ==============================================================================
set -euo pipefail

APP_DIR="/opt/flussonic-admin"
ENV_FILE="$APP_DIR/backend/.env"
SERVICE_NAME="flussonic-admin"

die() { echo "ERR: $*" >&2; exit 1; }
[[ "$(id -u)" == "0" ]] || die "Must run as root (try with sudo)."
[[ -f "$ENV_FILE" ]] || die ".env not found at $ENV_FILE — is the panel installed?"
[[ -x "$APP_DIR/backend/.venv/bin/python" ]] || die "Backend virtualenv missing at $APP_DIR/backend/.venv"

EMAIL="${1:-}"
PASSWORD="${2:-}"

# Prompt if not provided
if [[ -z "$EMAIL" ]]; then
  CURRENT_EMAIL="$(grep -E '^ADMIN_EMAIL=' "$ENV_FILE" | cut -d= -f2-)"
  read -rp "Admin email [${CURRENT_EMAIL:-admin@localhost}]: " EMAIL
  EMAIL="${EMAIL:-$CURRENT_EMAIL}"
fi
if [[ -z "$PASSWORD" ]]; then
  read -rsp "New password (input hidden): " PASSWORD; echo
  [[ -n "$PASSWORD" ]] || die "Password cannot be empty"
  read -rsp "Confirm: " CONFIRM; echo
  [[ "$PASSWORD" == "$CONFIRM" ]] || die "Passwords do not match"
fi
[[ ${#PASSWORD} -ge 4 ]] || die "Password must be at least 4 characters"

echo "» Updating $ENV_FILE"
# Replace ADMIN_EMAIL / ADMIN_PASSWORD (add if missing)
if grep -q '^ADMIN_EMAIL=' "$ENV_FILE"; then
  sed -i "s|^ADMIN_EMAIL=.*|ADMIN_EMAIL=$EMAIL|" "$ENV_FILE"
else
  echo "ADMIN_EMAIL=$EMAIL" >> "$ENV_FILE"
fi
if grep -q '^ADMIN_PASSWORD=' "$ENV_FILE"; then
  # Escape | and \ in password to keep sed happy; we use a different delimiter (|)
  ESCAPED="${PASSWORD//|/\\|}"
  sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$ESCAPED|" "$ENV_FILE"
else
  echo "ADMIN_PASSWORD=$PASSWORD" >> "$ENV_FILE"
fi

echo "» Updating Mongo user document"
# Run a small Python snippet using the installed backend's venv so we share its deps.
ADMIN_EMAIL="$EMAIL" ADMIN_PASSWORD="$PASSWORD" \
"$APP_DIR/backend/.venv/bin/python" - <<'PY'
import asyncio, os, sys
sys.path.insert(0, "/opt/flussonic-admin/backend")
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import dotenv_values

env = dotenv_values("/opt/flussonic-admin/backend/.env")
mongo_url = env["MONGO_URL"]
db_name = env["DB_NAME"]
email = os.environ["ADMIN_EMAIL"].lower().strip()
password = os.environ["ADMIN_PASSWORD"]

# Import the same password hashing the backend uses (passlib bcrypt)
from passlib.hash import bcrypt
hashed = bcrypt.hash(password)

async def main():
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    res = await db.users.update_one(
        {"email": email},
        {"$set": {
            "email": email,
            "password_hash": hashed,
            "name": "Admin",
            "role": "admin",
            "parent_id": None,
            "active": True,
        }, "$setOnInsert": {"created_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    print(f"  matched={res.matched_count} modified={res.modified_count} upserted={res.upserted_id is not None}")
    client.close()

asyncio.run(main())
PY

echo "» Restarting $SERVICE_NAME"
systemctl restart "$SERVICE_NAME"
sleep 1
systemctl is-active --quiet "$SERVICE_NAME" || die "backend did not come back up — check: journalctl -u $SERVICE_NAME -n 50"

echo
echo "✓ Admin credentials updated."
echo "  Email:    $EMAIL"
echo "  Password: $PASSWORD"
echo
echo "  Sign in at your panel URL with these credentials."
