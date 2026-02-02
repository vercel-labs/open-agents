#!/bin/zsh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$REPO_ROOT"

echo "Installing dependencies..."
bun install

if [[ ! -f "$REPO_ROOT/apps/cli/.env" ]]; then
  cp "$REPO_ROOT/apps/cli/.env.example" "$REPO_ROOT/apps/cli/.env"
  echo "✓ Created apps/cli/.env from .env.example"
fi

if [[ ! -f "$REPO_ROOT/apps/web/.env" ]]; then
  cp "$REPO_ROOT/apps/web/.env.example" "$REPO_ROOT/apps/web/.env"
  echo "✓ Created apps/web/.env from .env.example"
fi

if command -v vc >/dev/null 2>&1; then
  echo "Syncing Vercel env..."
  "$REPO_ROOT/scripts/refresh-vercel-token.sh"
else
  echo "Vercel CLI (vc) not found. Install it and run scripts/refresh-vercel-token.sh after \"vc link\"."
fi

echo "Setup complete. Fill in any remaining env vars in apps/cli/.env (GitHub token) and apps/web/.env."
