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
  vc env pull "$REPO_ROOT/.env.local" --cwd "$REPO_ROOT"

  if [[ -f "$REPO_ROOT/.env.local" ]]; then
    # Variables to sync from .env.local into apps/web/.env
    WEB_SYNC_VARS=(
      VERCEL_OIDC_TOKEN
      BLOB_READ_WRITE_TOKEN
      REDIS_URL
      VERCEL_APP_CLIENT_SECRET
      NEXT_PUBLIC_VERCEL_APP_CLIENT_ID
      NEXT_PUBLIC_GITHUB_CLIENT_ID
      GITHUB_CLIENT_SECRET
    )

    for var in "${WEB_SYNC_VARS[@]}"; do
      value=$(grep "^${var}=" "$REPO_ROOT/.env.local" | head -1) || true
      if [[ -n "$value" ]]; then
        # Remove existing line and append fresh value
        grep -v "^${var}=" "$REPO_ROOT/apps/web/.env" > "$REPO_ROOT/apps/web/.env.tmp" || true
        mv "$REPO_ROOT/apps/web/.env.tmp" "$REPO_ROOT/apps/web/.env"
        echo "$value" >> "$REPO_ROOT/apps/web/.env"
      fi
    done
    echo "✓ Synced Vercel env vars into apps/web/.env"

    # Sync VERCEL_OIDC_TOKEN into CLI .env
    cli_token=$(grep "^VERCEL_OIDC_TOKEN=" "$REPO_ROOT/.env.local" | head -1) || true
    if [[ -n "$cli_token" ]]; then
      grep -v "^VERCEL_OIDC_TOKEN=" "$REPO_ROOT/apps/cli/.env" > "$REPO_ROOT/apps/cli/.env.tmp" || true
      mv "$REPO_ROOT/apps/cli/.env.tmp" "$REPO_ROOT/apps/cli/.env"
      echo "$cli_token" >> "$REPO_ROOT/apps/cli/.env"
      echo "✓ Synced VERCEL_OIDC_TOKEN into apps/cli/.env"
    fi
  fi
else
  echo "Vercel CLI (vc) not found. Install it and run scripts/refresh-vercel-token.sh after \"vc link\"."
fi

echo "Setup complete. Fill in any remaining env vars in apps/cli/.env (GitHub token) and apps/web/.env."
echo "To run: first start the web app with 'bun run web', then start the CLI with 'bun run cli'."
