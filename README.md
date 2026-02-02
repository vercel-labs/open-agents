# Open Harness

## Setup

```bash
bun install
vc link
./scripts/setup.sh
```

`scripts/setup.sh` will:
- Copy `apps/cli/.env.example` and `apps/web/.env.example` to `.env` if missing
- Pull Vercel env into `.env.local` and sync `VERCEL_OIDC_TOKEN` / `BLOB_READ_WRITE_TOKEN` / `POSTGRES_URL` into app envs

### Credentials

CLI (`apps/cli/.env`):
- `GITHUB_TOKEN`
- `VERCEL_OIDC_TOKEN` (auto-filled by setup after `vc link`)

Web (`apps/web/.env`):
- `POSTGRES_URL`
- `JWE_SECRET` (example: `openssl rand -base64 32`)
- `ENCRYPTION_KEY` (example: `openssl rand -hex 32`)
- `CLI_TOKEN_ENCRYPTION_KEY` (example: `openssl rand -hex 32`)
- `NEXT_PUBLIC_AUTH_PROVIDERS` (`github`, `vercel`, or `github,vercel`)
- `NEXT_PUBLIC_GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET`
- `ELEVENLABS_API_KEY` (optional)
- `VERCEL_OIDC_TOKEN` + `BLOB_READ_WRITE_TOKEN` (auto-filled by setup after `vc link`)

If you update Vercel env vars later, re-run `scripts/refresh-vercel-token.sh`.

## Run

Web (start first):

```bash
bun run web
```

CLI (start after web):

```bash
bun run cli
```

## Release

See `docs/release.md`.

Release checklist (quick):

- Pick a unique version (can be multiple per day)
- Run the **Release CLI** GitHub Action with that version
- Verify install: `curl -fsSL https://openharness.dev/install | bash`

This project was created using `bun init` in bun v1.2.23. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
