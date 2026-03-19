#!/bin/zsh

# Refresh Vercel OIDC token and push to apps/web/.env
# Run from the main repo root

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Pulling fresh Vercel env..."
vc env pull "$REPO_ROOT/.env.local" --cwd "$REPO_ROOT"

if [[ -f "$REPO_ROOT/apps/web/.env" ]]; then
  grep -v "^VERCEL_OIDC_TOKEN=" "$REPO_ROOT/apps/web/.env" > "$REPO_ROOT/apps/web/.env.tmp" || true
  mv "$REPO_ROOT/apps/web/.env.tmp" "$REPO_ROOT/apps/web/.env"
  grep "^VERCEL_OIDC_TOKEN=" "$REPO_ROOT/.env.local" >> "$REPO_ROOT/apps/web/.env"
  echo "✓ Updated apps/web/.env"
fi

echo "Done!"
