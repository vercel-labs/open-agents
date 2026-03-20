Summary: Make sandbox sessions Vercel-CLI-ready by reusing the app’s existing Vercel OAuth access token. Refresh the token server-side, sync a CLI auth file into the sandbox, and provide project/org context automatically so agent-run `vercel` commands work without interactive login.

Context: The app already stores encrypted Vercel access/refresh tokens and refreshes them in `apps/web/lib/vercel/token.ts`. The OAuth callback in `apps/web/app/api/auth/vercel/callback/route.ts` persists the Vercel `externalId`, access token, refresh token, and expiry in `users`. Chat runtime already reconnects sandboxes with injected env in `apps/web/app/api/chat/_lib/runtime.ts`, but only for GitHub auth. Initial sandbox provisioning in `apps/web/app/api/sandbox/route.ts` already syncs linked Vercel project env vars into `.env.local`. Vercel CLI accepts bearer auth, but env-only `VERCEL_TOKEN` is unreliable in the current CLI version because the CLI checks for existing credentials before hoisting that env var. The CLI’s durable auth path is `auth.json`, and it can skip project linking when `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` are available. The CLI must not own the app-issued refresh token because CLI refresh uses Vercel CLI’s OAuth client, not this app’s OAuth client.

Approach: Keep token refresh entirely server-side and treat the app’s Vercel access token as the CLI credential. Add a structured helper that returns a fresh Vercel access token plus its expiry and the user’s Vercel `externalId`. Add a sandbox helper that syncs Vercel CLI auth into a managed XDG config directory inside the sandbox, writes/removes linked project metadata as needed, and returns the non-secret env vars needed for CLI project resolution. Use that helper in the agent chat runtime on every reconnect so CLI auth stays fresh, and prime the sandbox during initial provisioning so the first agent turn starts from a ready state.

Changes:
- `apps/web/lib/vercel/token.ts` - add a new structured helper (alongside `getUserVercelToken`) that returns `{ token, expiresAt, externalId }` after applying the existing refresh flow. Keep `getUserVercelToken()` as a thin wrapper for current callers.
- `apps/web/lib/sandbox/vercel-cli-auth.ts` - add a new helper to prepare sandbox Vercel CLI state. It should:
  - fetch fresh user Vercel auth via the new token helper
  - choose the CLI org ID from `session.vercelTeamId ?? user.externalId`
  - write a managed `auth.json` containing only `token` and `expiresAt`
  - write or remove `.vercel/project.json` based on the session’s linked Vercel project
  - expose the non-secret env needed for CLI resolution (`XDG_DATA_HOME`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` when available)
  - avoid writing the Vercel refresh token into CLI config
- `apps/web/app/api/chat/_lib/runtime.ts` - extend the existing sandbox runtime setup to call the new helper on every reconnect. Merge the helper’s env with the existing GitHub env before calling `connectSandbox()`, then sync the CLI files into the sandbox before skill discovery / agent execution.
- `apps/web/app/api/sandbox/route.ts` - after provisioning or reconnecting a sandbox for a session, call the same helper to prime Vercel CLI auth/project metadata early, next to the existing `.env.local` sync logic.
- `apps/web/app/api/sandbox/route.test.ts` - extend the existing sandbox provisioning tests to verify Vercel CLI prep runs: auth metadata is requested, auth/project files are written for linked projects, and the helper no-ops cleanly when no Vercel token is available.
- `apps/web/app/api/chat/route.test.ts` - update mocks for the new Vercel token/CLI prep path so the chat route keeps exercising the runtime without hitting real DB/auth code.
- `apps/web/lib/sandbox/vercel-cli-auth.test.ts` - add focused unit coverage for org/project resolution, auth file contents, stale-project cleanup, and the no-refresh-token rule.

Verification:
- Targeted tests:
  - `bun test apps/web/app/api/sandbox/route.test.ts`
  - `bun test apps/web/app/api/chat/route.test.ts`
  - `bun test apps/web/lib/sandbox/vercel-cli-auth.test.ts`
- End-to-end manual checks after implementation:
  - Sign in with Vercel, create/resume a sandbox, then ask the agent to run `npx vercel whoami`
  - Ask the agent to run a project-scoped command such as `npx vercel project inspect` or `npx vercel env pull .env.local --yes`
  - Verify commands work without interactive login or passing `--token`
  - Verify linked-team sessions resolve team-scoped projects, and personal-scope sessions fall back to the user’s Vercel `externalId`
  - Verify sessions without a Vercel token do not leave stale CLI auth behind
- Full repo validation after code changes:
  - `bun run ci`
- Known risk to check explicitly:
  - Some Vercel CLI commands may still be limited by the permissions granted to the app’s OAuth token. If a command fails for permission reasons after auth succeeds, that is a product-permissions gap, not a sandbox-auth plumbing bug.
