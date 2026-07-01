#!/usr/bin/env bash
# ==============================================================================
#  amixpanel-install-flussonic
#
#  Runs the official Flussonic Media Server installer in a way that the panel
#  can invoke through sudoers — without granting the panel user blanket root.
#
#  Usage:   sudo amixpanel-install-flussonic <INSTALL_URL> [LICENSE_KEY]
#  Where    INSTALL_URL defaults to https://flussonic.com/install.sh
#  Status:  writes pid+status to /var/lib/amixpanel/install.{pid,status}
# ==============================================================================
set -e

INSTALL_URL="${1:-https://flussonic.com/install.sh}"
LICENSE_KEY="${2:-}"
STATE_DIR="/var/lib/amixpanel"
mkdir -p "$STATE_DIR"

# Verify HTTPS scheme — never pipe-to-shell anything that isn't HTTPS to a
# flussonic.com origin (defence-in-depth against a future config error).
case "$INSTALL_URL" in
  https://flussonic.com/* | https://*.flussonic.com/*) : ;;
  *)
    echo "[helper] refusing to run installer from non-flussonic origin: $INSTALL_URL" >&2
    exit 2 ;;
esac

echo "$$" > "$STATE_DIR/install.pid"
echo "running" > "$STATE_DIR/install.status"

trap 'echo "$? exited" > "$STATE_DIR/install.status"' EXIT

# Export the license key so Flussonic's installer can register it during setup.
if [[ -n "$LICENSE_KEY" ]]; then
  export FLUSSONIC_LICENSE_KEY="$LICENSE_KEY"
fi

echo "[helper] $(date -Is) running official installer from $INSTALL_URL"
curl -fsSL "$INSTALL_URL" | sh
RC=$?

if [[ $RC -eq 0 ]]; then
  systemctl enable --now flussonic 2>/dev/null || true
  echo "ok" > "$STATE_DIR/install.status"
  echo "[helper] install OK"
else
  echo "fail $RC" > "$STATE_DIR/install.status"
  echo "[helper] install FAILED rc=$RC" >&2
fi
exit $RC
