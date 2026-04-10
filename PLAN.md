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
- Manually verify:
  - opt-in off => `/[username]` 404s
  - opt-in on => `/[username]` renders public stats
  - `?date=30d` and `?date=2026-01-01..2026-01-31` both filter correctly
  - invalid `?date=` returns a safe fallback or 400-style handling on the public surface, depending on final implementation choice
  - social metadata points at the generated image and the image reflects the selected date filter
  - existing `/[username]/[repo]` onboarding still works unchanged