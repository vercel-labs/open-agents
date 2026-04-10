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
Summary: Ship a shareable public usage profile at `/[username]` backed by existing usage data, gated by an opt-in setting, with `?date=` filtering for both presets and explicit ranges, plus a dynamic OG image generated from the same derived stats.

Context:
- `apps/web/app/settings/profile/page.tsx` already contains the closest “wrapped” content model: totals, top models, agent split, code churn, repositories, and usage insights.
- Usage source of truth already exists in `usage_events` and `sessions`, exposed through `apps/web/lib/db/usage.ts` and `apps/web/lib/db/usage-insights.ts`.
- Existing filtering is `from`/`to` only via `apps/web/lib/usage/date-range.ts` and `apps/web/app/api/usage/_lib/query-range.ts`; there is no `?date=` parser yet.
- Usernames already live on `users.username` in `apps/web/lib/db/schema.ts`, so `/[username]` can resolve a profile without inventing new slugs.
- `apps/web/app/[username]/[repo]/page.tsx` means root-level username routing already exists; adding `apps/web/app/[username]/page.tsx` is compatible, though static top-level routes remain reserved.
- There is no existing OG image implementation in `apps/web`, so the image route will be new.
- Confirmed product decisions:
  - public pages are opt-in
  - `?date=` should support both presets and explicit ranges
  - the public page should be a share-focused wrapped summary, not the full internal profile screen

System Impact:
- Source of truth stays the same: `users` for identity, `user_preferences` for publishability, `usage_events` / `sessions` for stats.
- New state introduced: a single persisted opt-in flag (`publicUsageEnabled`) stored with user preferences.
- Public page rendering, metadata, and OG image all depend on one shared server-side “public usage profile” derivation so the page and image cannot drift.
- `/[username]` becomes a public read surface; users with usernames colliding with static app routes are implicitly reserved unless we later add aliases.
- No new dependency is required; the OG image can use Next’s built-in image response support.

Approach:
- Add an opt-in preference on `user_preferences`, expose it in settings with the resulting public URL, and keep the route hard-disabled unless enabled.
- Add a small date parsing helper for public share URLs that accepts both preset windows (`7d`, `30d`, `90d`) and explicit ranges (`YYYY-MM-DD..YYYY-MM-DD`), then converts them into the existing `UsageDateRange` shape.
- Create one server-side public-profile query/helper that resolves a user by username, verifies opt-in, fetches usage + insights for the requested range, and derives the wrapped-summary data needed by both the HTML page and the OG image.
- Implement `/[username]` as a server-rendered page with `generateMetadata`, and point metadata at a dedicated dynamic image route that mirrors the same date filter.

Changes:
- `apps/web/lib/db/schema.ts` - add `public_usage_enabled` to `user_preferences` so publishability is persisted with other user-configurable settings.
- `apps/web/lib/db/migrations/*.sql` - add the generated migration for the new preference column.
- `apps/web/lib/db/user-preferences.ts` - include `publicUsageEnabled` in defaults, normalization, reads, and updates.
- `apps/web/hooks/use-user-preferences.ts` - expose `publicUsageEnabled` to the client settings UI.
- `apps/web/app/api/settings/preferences/route.ts` - validate and persist the new boolean preference.
- `apps/web/lib/usage/date-range.ts` and `apps/web/lib/usage/date-range.test.ts` - add shared parsing for public `?date=` values while keeping existing `from`/`to` helpers intact.
- `apps/web/lib/db/public-usage-profile.ts` (new) - resolve username + opt-in state, fetch usage/insights for a range, and derive share-card stats like totals, top models, agent split, code churn, and date label.
- `apps/web/lib/db/public-usage-profile.test.ts` (new) - cover opt-in gating, username lookup, empty usage, preset/range filtering handoff, and derived top-model ordering.
- `apps/web/app/[username]/page.tsx` - render the new public wrapped-style page and return `notFound()` when the user does not exist or is not public.
- `apps/web/app/[username]/og/route.tsx` (new) - generate the dynamic OG image from the same public-profile helper and date filter.
- `apps/web/app/settings/profile/page.tsx` or a colocated extracted child component - add the opt-in toggle and share URL preview/copy affordance in the existing profile/settings surface.

Verification:
- Run `bun run --cwd apps/web db:generate` after the schema change.
- Run `bun run ci`.
- With a healthy GitHub connection, confirm the global gate does not appear and installation/repo pickers behave as before.
- Simulate an invalid GitHub token or revoked/reduced installation state and confirm the app shows the reconnect prompt before normal use.
- Confirm the reconnect CTA returns the user to their original page and repopulates installations without requiring manual disconnect.
- Confirm settings/connections now shows a reconnect-specific state instead of a misleading zero-installations empty state.
- Confirm repo picker, create-repo flow, and sandbox/session entry points all surface the same reconnect path if reached while invalid.
- Manually verify:
  - opt-in off => `/[username]` 404s
  - opt-in on => `/[username]` renders public stats
  - `?date=30d` and `?date=2026-01-01..2026-01-31` both filter correctly
  - invalid `?date=` returns a safe fallback or 400-style handling on the public surface, depending on final implementation choice
  - social metadata points at the generated image and the image reflects the selected date filter
  - existing `/[username]/[repo]` onboarding still works unchanged
