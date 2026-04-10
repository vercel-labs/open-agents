Summary: Detect invalid GitHub connections from live GitHub data instead of trusting cached installation rows, then show a global reconnect prompt that sends the user through a non-destructive re-auth flow before they keep using the app.

Context:
- GitHub installation state is currently treated as DB-backed cached data. `apps/web/app/api/auth/info/route.ts` only reports whether an account row or installation rows exist; it never checks whether the GitHub token or installations are still valid.
- Installation sync only happens in `apps/web/app/api/github/app/install/route.ts`, `apps/web/app/api/github/app/callback/route.ts`, and via webhook updates in `apps/web/app/api/github/webhook/route.ts`. Normal app loads do not refresh installation truth from GitHub.
- The connectors UI in `apps/web/app/settings/accounts-section.tsx` fetches `/api/github/orgs/install-status`, which depends on `getUserGitHubToken()` plus DB installation rows. If the GitHub token is invalid or GitHub returns an auth error, the component currently falls through to the empty state and looks like “zero installations” instead of surfacing “reconnect GitHub”.
- Repo-selection surfaces (`apps/web/components/repo-selector-compact.tsx`, `apps/web/components/repo-selector.tsx`, `apps/web/components/create-repo-dialog.tsx`) also trust `/api/github/installations`, which is DB-only and does not distinguish “never installed” from “previously connected but now invalidated”.
- There is already reconnect intent in the codebase: `apps/web/app/api/auth/github/unlink/route.ts` sets a `github_reconnect` cookie, and `apps/web/app/api/github/app/callback/route.ts` clears it, but `apps/web/app/api/github/app/install/route.ts` never reads it. So reconnect support is partially sketched but not actually wired.

System Impact:
- Source of truth for “is GitHub usable right now?” should shift from cached DB presence to a lightweight GitHub health check using the current user token plus a fresh installation sync.
- The DB remains the local cache for installation lists, but reconnect gating should be derived from live validation, not just row existence.
- A global reconnect state becomes available to all authenticated screens, so the app can block or interrupt flows before users hit repo picker, sandbox creation, or settings confusion.
- The reconnect action should be non-destructive: re-run OAuth/install flow first, then refresh cached installations. Do not require manual disconnect before reconnect.

Approach:
- Add a dedicated GitHub connection-health endpoint that, for authenticated users with a linked GitHub account, validates the user token, attempts a fresh installation sync, and returns one of: connected, disconnected, or reconnect_required.
- Treat these cases as reconnect_required: user token missing/refresh failed, GitHub auth failure during the health check, or installations dropping from previously-present to zero after a live sync.
- Add a dedicated reconnect entrypoint that sends the user back through the existing GitHub install/auth flow in reconnect mode without forcing them to manually disconnect first.
- Mount a global authenticated reconnect gate near the app root so the prompt appears before users start a session or navigate deep into flows.
- Tighten local surfaces so settings/repo selection show explicit reconnect messaging instead of ambiguous empty states when the health check has already determined GitHub is invalid.

Changes:
- `apps/web/app/api/github/connection-status/route.ts` - new endpoint that validates the GitHub account, performs a guarded live installation sync, and returns structured status/reason/action URL data.
- `apps/web/lib/github/installations-sync.ts` - optionally add small error classification helpers so callers can distinguish auth failures from transient GitHub/API failures.
- `apps/web/app/api/github/app/install/route.ts` - honor reconnect mode instead of blindly using the existing linked-account path; route reconnects through OAuth when needed.
- `apps/web/app/api/auth/github/reconnect/route.ts` (new) or equivalent install-route support - provide a stable non-destructive reconnect URL that preserves `next`.
- `apps/web/app/providers.tsx` - mount a global reconnect checker/gate for authenticated users, likely via a small child component under the existing SWR provider.
- `apps/web/components/github-reconnect-dialog.tsx` (new) - blocking or near-blocking reconnect prompt with primary CTA back into the reconnect flow.
- `apps/web/app/settings/accounts-section.tsx` - replace the current misleading empty/error fallthrough with explicit reconnect-aware states.
- `apps/web/components/repo-selector-compact.tsx`, `apps/web/components/repo-selector.tsx`, `apps/web/components/create-repo-dialog.tsx` - consume the same reconnect status so repo-related entry points show the right CTA instead of generic “no installations”.
- Tests for the new connection-status route and reconnect-mode install flow, plus focused UI tests where practical.

Verification:
- Run `bun run ci`.
- With a healthy GitHub connection, confirm the global gate does not appear and installation/repo pickers behave as before.
- Simulate an invalid GitHub token or revoked/reduced installation state and confirm the app shows the reconnect prompt before normal use.
- Confirm the reconnect CTA returns the user to their original page and repopulates installations without requiring manual disconnect.
- Confirm settings/connections now shows a reconnect-specific state instead of a misleading zero-installations empty state.
- Confirm repo picker, create-repo flow, and sandbox/session entry points all surface the same reconnect path if reached while invalid.