#!/usr/bin/env bash
# ==============================================================================
#  Flussonic Admin — update helper (runs as root via sudoers)
#
#  Invoked by the backend API to apply panel updates from an uploaded tarball.
#
#  Modes:
#    flussonic-admin-update quick    <tarball>   # replace backend/+frontend/build/, restart
#    flussonic-admin-update full     <tarball>   # full reinstall via install.sh
#    flussonic-admin-update rollback             # restore previous backup
#    flussonic-admin-update version              # print current /opt VERSION
#
#  Backups go to /opt/flussonic-admin.bak (single rolling backup).
# ==============================================================================
set -euo pipefail

APP_DIR="/opt/flussonic-admin"
BAK_DIR="/opt/flussonic-admin.bak"
SERVICE_NAME="flussonic-admin"

die() { echo "ERR: $*" >&2; exit 1; }
log() { echo "» $*"; }

require_root() { [[ "$(id -u)" == "0" ]] || die "must run as root"; }

backup_current() {
  rm -rf "$BAK_DIR"
  cp -a "$APP_DIR" "$BAK_DIR"
}

restart_backend() {
  systemctl restart "${SERVICE_NAME}" >/dev/null
  sleep 2
  systemctl is-active --quiet "${SERVICE_NAME}" || die "backend failed to restart — rolling back recommended"
}

reload_nginx() {
  if command -v nginx >/dev/null && systemctl is-active --quiet nginx 2>/dev/null; then
    nginx -t >/dev/null 2>&1 && systemctl reload nginx >/dev/null || true
  fi
}

extract_tarball() {
  local tarball="$1"
  local stage; stage="$(mktemp -d /tmp/flussonic-update.XXXXXX)"
  tar -xzf "$tarball" -C "$stage" || die "extract failed"
  # tarball is wrapped in flussonic-admin-<version>/
  local inner
  inner="$(find "$stage" -maxdepth 1 -mindepth 1 -type d | head -n1)"
  [[ -d "$inner/backend" && -d "$inner/frontend" ]] || die "invalid tarball — backend/+frontend/ not found"
  echo "$inner"
}

cmd_version() {
  if [[ -f "$APP_DIR/VERSION" ]]; then cat "$APP_DIR/VERSION"; else echo "unknown"; fi
}

cmd_quick() {
  require_root
  local tarball="${1:-}"; [[ -f "$tarball" ]] || die "tarball not found: $tarball"
  log "Quick update from $tarball"

  local inner; inner="$(extract_tarball "$tarball")"
  backup_current

  # Replace backend code (preserve .env + .venv)
  log "Refreshing backend/ (keeping .env, .venv)"
  find "$APP_DIR/backend" -maxdepth 1 -mindepth 1 \
       ! -name ".env" ! -name ".venv" -exec rm -rf {} +
  cp -a "$inner/backend/." "$APP_DIR/backend/"

  # Re-install any new python deps (best effort)
  if [[ -f "$APP_DIR/backend/requirements.txt" && -x "$APP_DIR/backend/.venv/bin/pip" ]]; then
    "$APP_DIR/backend/.venv/bin/pip" install -q -r "$APP_DIR/backend/requirements.txt" || true
  fi

  # Rebuild frontend if sources changed
  if [[ -f "$inner/frontend/package.json" ]]; then
    log "Rebuilding frontend/ bundle"
    rm -rf "$APP_DIR/frontend"
    cp -a "$inner/frontend" "$APP_DIR/frontend"
    if command -v yarn >/dev/null; then
      ( cd "$APP_DIR/frontend" && yarn install --silent --frozen-lockfile 2>/dev/null || yarn install --silent ) || true
      ( cd "$APP_DIR/frontend" && yarn build 2>&1 | tail -3 ) || die "yarn build failed"
    fi
  fi

  # Refresh VERSION + install/ scripts
  cp -f "$inner/VERSION" "$APP_DIR/VERSION" 2>/dev/null || true
  if [[ -d "$inner/install" ]]; then
    rm -rf "$APP_DIR/install"
    cp -a "$inner/install" "$APP_DIR/install"
  fi

  chown -R "${SERVICE_NAME}":"${SERVICE_NAME}" "$APP_DIR" 2>/dev/null || true
  rm -rf "$(dirname "$inner")"

  restart_backend
  reload_nginx
  log "Quick update OK → $(cmd_version)"
}

cmd_full() {
  require_root
  local tarball="${1:-}"; [[ -f "$tarball" ]] || die "tarball not found: $tarball"
  log "Full reinstall from $tarball"

  local inner; inner="$(extract_tarball "$tarball")"
  backup_current

  [[ -x "$inner/install/install.sh" ]] || die "install.sh missing in tarball"
  bash "$inner/install/install.sh" --source-dir "$inner" --no-mongo
  rm -rf "$(dirname "$inner")"
  log "Full reinstall OK → $(cmd_version)"
}

cmd_rollback() {
  require_root
  [[ -d "$BAK_DIR" ]] || die "no backup at $BAK_DIR"
  log "Rolling back from $BAK_DIR"
  local revert; revert="$(mktemp -d /tmp/flussonic-rollback.XXXXXX)"
  mv "$APP_DIR" "$revert/current"
  mv "$BAK_DIR" "$APP_DIR"
  mv "$revert/current" "$BAK_DIR"
  chown -R "${SERVICE_NAME}":"${SERVICE_NAME}" "$APP_DIR" 2>/dev/null || true
  restart_backend
  reload_nginx
  log "Rollback OK → $(cmd_version)"
}

case "${1:-}" in
  quick)    shift; cmd_quick    "$@" ;;
  full)     shift; cmd_full     "$@" ;;
  rollback) shift; cmd_rollback "$@" ;;
  version)  cmd_version ;;
  *) die "usage: $0 {quick|full|rollback|version} [tarball]" ;;
esac
