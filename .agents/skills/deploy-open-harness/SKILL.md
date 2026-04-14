---
name: deploy-open-harness
description: Guides a user through collecting the credentials needed to deploy their own copy of Open Harness, deploying this repo on Vercel, and completing first-run setup. Use for requests about deploying, self-hosting, configuring credentials, or getting started with a fork of this app.
---

You are helping a user deploy their own copy of Open Harness.

Base your guidance on the current codebase, not on older Harness-era setup assumptions.

## First rule: verify current requirements from the repo

Before giving deployment advice, read these files if you have not already:

- `README.md`
- `apps/web/.env.example`
- `apps/web/lib/db/client.ts`
- `apps/web/lib/jwe/encrypt.ts`
- `apps/web/lib/crypto.ts`
- `apps/web/app/api/auth/signin/workos/route.ts`
- `apps/web/app/api/auth/workos/callback/route.ts`
- `apps/web/app/api/github/app/install/route.ts`
- `apps/web/app/api/github/app/callback/route.ts`
- `apps/web/lib/github/app-auth.ts`
- `apps/web/lib/redis.ts`
- `apps/web/lib/sandbox/config.ts`

If the code and the docs disagree, trust the code and say so.

Do not rely on `scripts/setup.sh`.

## Goals

Help the user:

1. Decide whether they want a minimal deploy or the full GitHub-enabled coding-agent flow.
2. Collect only the credentials actually required for that scope.
3. Understand where to obtain each credential.
4. Deploy this repo on Vercel.
5. Complete first-run verification.
6. Leave with a short next-steps checklist.

## Safety rules

- Never ask the user to paste secrets into chat.
- Tell them where each value belongs, but keep secret values in Vercel project env vars or local env files.
- Separate blockers for a minimal deploy from blockers for the full GitHub-enabled flow.
- Be explicit when something is optional.

## Scope the deployment first

Start by determining which path the user wants:

### 1) Minimal deploy
A working hosted app where the user can deploy it, sign in with WorkOS AuthKit, and use the product without GitHub repo access.

### 2) Full deploy
Everything in the minimal deploy, plus GitHub account linking, GitHub App installation, private repo access, pushes, and PR creation.

If the user is unsure, recommend **minimal deploy first**, then layer on GitHub.

## Credential checklist

Use this checklist when guiding the user.

### Required for the app to run

- `POSTGRES_URL`
- `JWE_SECRET`

### Required for a usable hosted deployment

- `ENCRYPTION_KEY`
- `WORKOS_API_KEY`
- `WORKOS_CLIENT_ID`

### Required for GitHub-enabled repo flows

- `NEXT_PUBLIC_GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `NEXT_PUBLIC_GITHUB_APP_SLUG`
- `GITHUB_WEBHOOK_SECRET`

### Optional

- `REDIS_URL` or `KV_URL`
- `VERCEL_PROJECT_PRODUCTION_URL`
- `NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL`
- `VERCEL_SANDBOX_BASE_SNAPSHOT_ID`
- `ELEVENLABS_API_KEY`

## How to explain each credential

### PostgreSQL
Tell the user to create a Postgres database and copy the connection string into `POSTGRES_URL`.

### JWE secret
Explain that this is required for session encryption.

Recommended generation command:

```bash
openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'
```

### Encryption key
Explain that provider tokens are encrypted at rest and the value must be a 64-character hex string.

Recommended generation command:

```bash
openssl rand -hex 32
```

### WorkOS AuthKit
Tell the user to create a WorkOS account and set up an AuthKit application. Configure the redirect URI:

- Redirect URI: `https://YOUR_DOMAIN/api/auth/workos/callback`
- For local dev: `http://localhost:3000/api/auth/workos/callback`

Store the credentials as:

- `WORKOS_API_KEY`
- `WORKOS_CLIENT_ID`

### GitHub App
Tell the user they do not need a separate GitHub OAuth app. Open Harness uses the GitHub App's user authorization flow.

Tell the user to create a GitHub App and set:

- Homepage URL: `https://YOUR_DOMAIN`
- Callback URL: `https://YOUR_DOMAIN/api/github/app/callback`
- Setup URL: `https://YOUR_DOMAIN/api/github/app/callback`
- For local dev: homepage `http://localhost:3000`, callback/setup `http://localhost:3000/api/github/app/callback`

Also tell them to:

- enable "Request user authorization (OAuth) during installation"
- use the GitHub App Client ID and Client Secret for `NEXT_PUBLIC_GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`
- make the app public if they want org installs to work cleanly
- generate a webhook secret
- download/generate the private key

Store the values as:

- `NEXT_PUBLIC_GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `NEXT_PUBLIC_GITHUB_APP_SLUG`
- `GITHUB_WEBHOOK_SECRET`

Mention that `GITHUB_APP_PRIVATE_KEY` can be stored either as PEM contents with escaped newlines or as a base64-encoded PEM.

### Redis / KV
Explain that Redis is optional. It improves resumable streams, stop signaling, and caching, but it is not required for the first deploy.

## Deployment flow

Guide the user through this sequence:

1. Fork the repo.
2. Import it into Vercel at the repo root.
3. Add the baseline env vars:
   - `POSTGRES_URL`
   - `JWE_SECRET`
   - `ENCRYPTION_KEY`
4. Deploy once to get a stable production URL.
5. Create the WorkOS AuthKit application using that production URL as the redirect URI.
6. Add `WORKOS_API_KEY` and `WORKOS_CLIENT_ID`.
7. Redeploy.
8. If the user wants the full GitHub flow, create the GitHub App using the production URL, add the GitHub env vars, and redeploy again.
9. Optionally add Redis/KV and the production URL vars.

If the user already has a custom domain ready, it is fine to use that domain from the start instead of the default `vercel.app` production URL.

## First-run verification

For a minimal deploy, walk the user through:

1. Open the production site.
2. Sign in via WorkOS AuthKit.
3. Confirm they land in the app successfully.
4. Create a session and confirm the basic UI loads.

For the full deploy, also verify:

1. GitHub account linking works.
2. GitHub App installation completes.
3. Installations or repos appear in the UI.
4. A repo-backed session can start.
5. The sandbox starts and the agent can work in the repo.

If something fails, identify the missing credential or callback mismatch instead of giving generic advice.

## Response format

When helping a user, prefer this structure:

1. **Target scope** — minimal or full.
2. **Credential checklist** — grouped into required now vs optional later.
3. **How to get each missing credential** — short, concrete instructions.
4. **Deploy steps** — only the next actions the user should take.
5. **Verification** — what to click/test after deploy.
6. **Next upgrades** — Redis, GitHub, voice, custom domain, snapshot override, only if relevant.

Be concise. Keep the user moving toward the next unblocker.
