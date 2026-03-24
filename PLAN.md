Summary: Add an internal usage leaderboard to the existing Usage settings page by deriving the viewer’s email domain from the authenticated session, aggregating usage for matching users, and rendering the results in a sortable table alongside the current personal usage view.

Context: The existing usage experience lives in `apps/web/app/settings/usage-section.tsx` and pulls data from `apps/web/app/api/usage/route.ts`, which already supports the page’s date-range filter. Usage is recorded per assistant turn in `apps/web/lib/db/usage.ts` and stored in `usage_events` (`apps/web/lib/db/schema.ts`), while authenticated user emails are already stored on `users.email`. There is no existing leaderboard or domain-based sharing logic, so the safest fit is to compute the leaderboard server-side from the current session email and never accept a client-provided domain.

Approach: Extend the existing usage API response with an optional domain leaderboard payload. Compute it in a focused DB helper that joins `usage_events` to `users`, filters by the viewer’s own email domain (starting with `vercel.com` as the internal domain we need), aggregates totals per user/model for the current date range, and derives each user’s most-used model in application code. In the UI, keep the current personal usage cards unchanged and append a new table section that only renders when leaderboard data is available.

Changes:
- `apps/web/lib/usage/types.ts` - add typed structures for the domain leaderboard payload.
- `apps/web/lib/db/usage-domain-leaderboard.ts` - add server-side helpers to parse/validate the viewer domain, query matching users’ usage, and derive per-user leaderboard rows sorted by total tokens.
- `apps/web/app/api/usage/route.ts` - include the optional domain leaderboard in the existing usage response, reusing the current date-range filter and authenticated session.
- `apps/web/app/settings/usage/domain-usage-leaderboard-section.tsx` - render the leaderboard as a table with user identity, total tokens, assistant turns, and most-used model.
- `apps/web/app/settings/usage-section.tsx` - extend the response typing and render the new leaderboard section below the existing usage insights.
- `apps/web/lib/db/usage-domain-leaderboard.test.ts` and/or `apps/web/app/api/usage/route.test.ts` - cover domain parsing/gating and leaderboard aggregation behavior.

Verification:
- Run targeted tests for the new leaderboard helper / route coverage.
- Run `bun run ci` from the repo root.
- Check edge cases: no session email, unsupported/non-internal domains, users with no usage in range, ties/default handling for missing model ids, and date-range filtering affecting the leaderboard the same way it affects personal usage.