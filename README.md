# Open Harness

## Setup

```bash
bun install
vc link
./scripts/setup.sh
```

When `vc link` prompts you, use team `vercel-labs` and project `open-harness-web`.

`scripts/setup.sh` will:
- Copy `apps/web/.env.example` to `.env` if missing
- Pull Vercel env into `.env.local`, then sync the relevant values into `apps/web/.env`

### Credentials

Web (`apps/web/.env`):
- `POSTGRES_URL`
- `JWE_SECRET` (example: `openssl rand -base64 32`)
- `ENCRYPTION_KEY` (example: `openssl rand -hex 32`)
- `NEXT_PUBLIC_AUTH_PROVIDERS` (`vercel`, `github`, or `vercel,github`)
- `NEXT_PUBLIC_VERCEL_APP_CLIENT_ID` + `VERCEL_APP_CLIENT_SECRET`
- `NEXT_PUBLIC_GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET`
- `ELEVENLABS_API_KEY` (optional)
- `VERCEL_OIDC_TOKEN` + `BLOB_READ_WRITE_TOKEN` (auto-filled by setup after `vc link`)

### Setting up Vercel OAuth (primary sign-in)

1. Go to [vercel.com/account/oauth-apps](https://vercel.com/account/oauth-apps) and create a new OAuth app
2. Set the redirect URI to `http://localhost:3000/api/auth/vercel/callback` (for local dev)
3. Copy the **Client ID** and **Client Secret** into your `apps/web/.env`:
   ```
   NEXT_PUBLIC_VERCEL_APP_CLIENT_ID=your_client_id_here
   VERCEL_APP_CLIENT_SECRET=your_client_secret_here
   ```
4. Make sure `NEXT_PUBLIC_AUTH_PROVIDERS` includes `vercel`

### Setting up GitHub OAuth (linked account for repo access)

GitHub is used as a linked account so users can access their repositories. It is not required for sign-in.

1. Go to [github.com/settings/developers](https://github.com/settings/developers) and create a new OAuth App
2. Set the **Homepage URL** to `http://localhost:3000` (for local dev)
3. Set the **Authorization callback URL** to `http://localhost:3000/api/auth/github/callback`
4. If you also want GitHub account linking (connecting GitHub after signing in with Vercel), add a second callback URL: `http://localhost:3000/api/auth/github/link/callback`
5. Copy the **Client ID** and **Client Secret** into your `apps/web/.env`:
   ```
   NEXT_PUBLIC_GITHUB_CLIENT_ID=your_client_id_here
   GITHUB_CLIENT_SECRET=your_client_secret_here
   ```

> **Note:** GitHub OAuth apps only support one callback URL. To support both `/api/auth/github/callback` (sign-in) and `/api/auth/github/link/callback` (account linking), create two separate OAuth apps, or use the same app and update the callback URL depending on the flow you need. In production, these are typically configured as separate apps.

If you update Vercel env vars later, re-run `scripts/refresh-vercel-token.sh`.
`scripts/refresh-vercel-token.sh` refreshes `VERCEL_OIDC_TOKEN` in `apps/web/.env`.

## Run

```bash
bun run web
```

This project was created using `bun init` in bun v1.2.23. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
