#!/bin/zsh

# Refresh Vercel OIDC token and push to app .env files
# Run from the main repo root

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Pulling fresh Vercel env..."
vc env pull "$REPO_ROOT/.env.local" --cwd "$REPO_ROOT"

# Update CLI .env
if [[ -f "$REPO_ROOT/apps/cli/.env" ]]; then
  # Remove existing token lines and append fresh ones
  grep -v "^VERCEL_OIDC_TOKEN=" "$REPO_ROOT/apps/cli/.env" > "$REPO_ROOT/apps/cli/.env.tmp" || true
  mv "$REPO_ROOT/apps/cli/.env.tmp" "$REPO_ROOT/apps/cli/.env"
  grep "^VERCEL_OIDC_TOKEN=" "$REPO_ROOT/.env.local" >> "$REPO_ROOT/apps/cli/.env"
  echo "✓ Updated apps/cli/.env"
fi

# Update Web .env
if [[ -f "$REPO_ROOT/apps/web/.env" ]]; then
  # Remove existing token line and append fresh one
  grep -v "^VERCEL_OIDC_TOKEN=" "$REPO_ROOT/apps/web/.env" > "$REPO_ROOT/apps/web/.env.tmp" || true
  mv "$REPO_ROOT/apps/web/.env.tmp" "$REPO_ROOT/apps/web/.env"
  grep "^VERCEL_OIDC_TOKEN=" "$REPO_ROOT/.env.local" >> "$REPO_ROOT/apps/web/.env"
  echo "✓ Updated apps/web/.env"
fi

echo "Done!"
