#!/bin/zsh

bun install
cp "$CONDUCTOR_ROOT_PATH/apps/web/.env" apps/web/.env

vc env pull "$CONDUCTOR_ROOT_PATH/.env.local" --cwd "$CONDUCTOR_ROOT_PATH"
grep "^VERCEL_OIDC_TOKEN=" "$CONDUCTOR_ROOT_PATH/.env.local" >> apps/web/.env
grep "^BLOB_READ_WRITE_TOKEN=" "$CONDUCTOR_ROOT_PATH/.env.local" >> apps/web/.env
