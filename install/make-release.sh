#!/usr/bin/env bash
# Build a distributable tarball of the amixpanel.
#
# Usage:
#   bash install/make-release.sh                 # → ./dist/amixpanel-<ver>.tar.gz
#   bash install/make-release.sh --version 1.2.0
#   bash install/make-release.sh --out /tmp      # custom output dir
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION=""
OUT="$ROOT/dist"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --out)     OUT="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  VERSION="$(date +%Y.%m.%d)-$(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo 'local')"
fi

NAME="amixpanel-${VERSION}"
mkdir -p "$OUT"

# ---------- validate bash scripts before packaging ---------------------------
echo "» Validating bash scripts (syntax + shellcheck)…"
SCRIPTS=(
  "$ROOT/install/install.sh"
  "$ROOT/install/make-release.sh"
)
[[ -f "$ROOT/install/amixpanel-update.sh" ]]         && SCRIPTS+=("$ROOT/install/amixpanel-update.sh")
[[ -f "$ROOT/install/amixpanel-reset-password.sh" ]] && SCRIPTS+=("$ROOT/install/amixpanel-reset-password.sh")
for s in "${SCRIPTS[@]}"; do
  bash -n "$s" || { echo "✗ syntax error in $s" >&2; exit 1; }
done
if command -v shellcheck >/dev/null; then
  # Only fail on errors, allow warnings (style-only)
  shellcheck -S error -e SC1091,SC2034 "${SCRIPTS[@]}" || \
    { echo "✗ shellcheck found errors — aborting release" >&2; exit 1; }
  echo "  ✓ shellcheck clean"
else
  echo "  ⚠ shellcheck not installed — skipping deep lint"
fi

echo "» Packing $NAME …"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/$NAME"

# Copy the things we ship
rsync -a --delete \
  --exclude '.git/' --exclude '.gitignore' \
  --exclude 'node_modules/' --exclude 'build/' \
  --exclude '.venv/' --exclude '__pycache__/' --exclude '*.pyc' \
  --exclude '.env' --exclude '.env.local' \
  --exclude 'test_reports/' --exclude '.emergent/' \
  --exclude 'memory/' --exclude 'design_guidelines.json' \
  --exclude 'dist/' \
  "$ROOT/backend" "$ROOT/frontend" "$ROOT/install" \
  "$TMP/$NAME/"

# Top-level README pointing at install/
cat > "$TMP/$NAME/README.md" <<EOF
# amixpanel — $VERSION

Self-hosted admin panel for Flussonic Media Server.

## Quick install

\`\`\`bash
sudo bash install/install.sh
\`\`\`

See **install/README.md** for all options (domain + Let's Encrypt, custom port,
existing MongoDB, uninstall, troubleshooting).
EOF

# Record version
echo "$VERSION" > "$TMP/$NAME/VERSION"

# Pack
TARBALL="$OUT/${NAME}.tar.gz"
( cd "$TMP" && tar --owner=0 --group=0 -czf "$TARBALL" "$NAME" )

SIZE="$(du -h "$TARBALL" | cut -f1)"
SHA="$(sha256sum "$TARBALL" | cut -d' ' -f1)"

echo
echo "✓ Built: $TARBALL  ($SIZE)"
echo "  sha256: $SHA"
echo
echo "Upload and install on a fresh server:"
echo "  scp $TARBALL root@server:/tmp/"
echo "  ssh root@server"
echo "  cd /tmp && tar xzf ${NAME}.tar.gz && cd ${NAME}"
echo "  sudo bash install/install.sh"
