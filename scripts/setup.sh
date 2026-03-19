#!/bin/zsh

set -e

SKIP_PULL=false
for arg in "$@"; do
  case "$arg" in
    --no-pull) SKIP_PULL=true ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$REPO_ROOT"

echo "Installing dependencies..."
bun install

if [[ ! -f "$REPO_ROOT/apps/web/.env" ]]; then
  cp "$REPO_ROOT/apps/web/.env.example" "$REPO_ROOT/apps/web/.env"
  echo "✓ Created apps/web/.env from .env.example"
fi

if [[ "$SKIP_PULL" == true ]]; then
  echo "Skipping vc env pull (--no-pull)"
elif command -v vc >/dev/null 2>&1; then
  echo "Syncing Vercel env..."
  vc env pull "$REPO_ROOT/.env.local" --cwd "$REPO_ROOT"
else
  echo "Vercel CLI (vc) not found. Install it and run 'vc link' to enable env syncing."
fi

if [[ -f "$REPO_ROOT/.env.local" ]]; then
  WEB_SYNC_VARS=(
    VERCEL_OIDC_TOKEN
    BLOB_READ_WRITE_TOKEN
    REDIS_URL
    VERCEL_APP_CLIENT_SECRET
    NEXT_PUBLIC_VERCEL_APP_CLIENT_ID
    NEXT_PUBLIC_GITHUB_CLIENT_ID
    GITHUB_CLIENT_SECRET
    GITHUB_APP_ID
    GITHUB_APP_PRIVATE_KEY
    NEXT_PUBLIC_GITHUB_APP_SLUG
    GITHUB_WEBHOOK_SECRET
  )

  for var in "${WEB_SYNC_VARS[@]}"; do
    value=$(grep "^${var}=" "$REPO_ROOT/.env.local" | head -1) || true
    if [[ -n "$value" ]]; then
      grep -v "^${var}=" "$REPO_ROOT/apps/web/.env" > "$REPO_ROOT/apps/web/.env.tmp" || true
      mv "$REPO_ROOT/apps/web/.env.tmp" "$REPO_ROOT/apps/web/.env"
      echo "$value" >> "$REPO_ROOT/apps/web/.env"
    fi
  done
  echo "✓ Synced Vercel env vars into apps/web/.env"
else
  echo "No .env.local found. Run 'vc env pull' or use scripts/setup.sh without --no-pull.'"
fi

echo "Setup complete. Fill in any remaining env vars in apps/web/.env."
echo "To run: bun run web"
