#!/usr/bin/env bash

# Refresh Vercel OIDC token and copy it into apps/web/.env.local.
# Run from the main repo root

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
ROOT_ENV_FILE="$REPO_ROOT/.env.local"
WEB_ENV_FILE="$REPO_ROOT/apps/web/.env.local"
TEMP_WEB_ENV_FILE="$WEB_ENV_FILE.tmp"

echo "Pulling fresh Vercel env..."
vc env pull "$ROOT_ENV_FILE" --cwd "$REPO_ROOT"

OIDC_TOKEN_LINE="$(grep "^VERCEL_OIDC_TOKEN=" "$ROOT_ENV_FILE" || true)"

if [[ -z "$OIDC_TOKEN_LINE" ]]; then
  echo "VERCEL_OIDC_TOKEN was not found in $ROOT_ENV_FILE" >&2
  exit 1
fi

touch "$WEB_ENV_FILE"
grep -v "^VERCEL_OIDC_TOKEN=" "$WEB_ENV_FILE" > "$TEMP_WEB_ENV_FILE" || true

if [[ -s "$TEMP_WEB_ENV_FILE" ]] && [[ "$(tail -c 1 "$TEMP_WEB_ENV_FILE")" != "" ]]; then
  printf "\n" >> "$TEMP_WEB_ENV_FILE"
fi

printf "%s\n" "$OIDC_TOKEN_LINE" >> "$TEMP_WEB_ENV_FILE"
mv "$TEMP_WEB_ENV_FILE" "$WEB_ENV_FILE"

echo "Updated apps/web/.env.local"
echo "Done!"
