Summary: Extend the current Vercel env-sync flow with a CLI-style manual link fallback. When repo-based matching finds no Vercel project, let the user choose a scope/team first and then a project within that scope, and persist that explicit choice as the repo’s remembered Vercel link.

Context: `apps/web/components/session-starter.tsx` currently only supports repo-url matches returned by `apps/web/app/api/vercel/repo-projects/route.ts`; if that list is empty it immediately sets the choice to `null` and only offers “start without env sync”. `apps/web/app/api/sessions/route.ts` also only accepts explicit selections that still appear in `listMatchingVercelProjects()`, so a manual team/project pick would be rejected today. The existing `vercel_project_links` table already persists repo-level defaults, and `apps/web/app/[username]/[repo]/page.tsx` already reuses saved links when auto-creating a session, so we can build on the current storage model instead of adding new persistence.

Approach: Keep the current repo-match flow unchanged when we already have 1+ matches. Only when there are zero repo matches, switch the UI into a fallback flow that mirrors `vercel link`: choose a Vercel scope/team, then choose a project in that scope, or opt out. Return the saved repo link separately from live repo matches so the client can prefill a previously chosen manual link even when it never shows up in repo-url matches. On submit, validate manual picks against the selected scope’s accessible projects (not against repo-url matches), then store the canonical project/team data in the existing repo-link table. I would keep this fallback-only for now rather than exposing a manual override on every repo flow.

Changes:
- `apps/web/lib/vercel/projects.ts` - factor out/export shared helpers for listing accessible scopes and listing projects for a selected scope, while keeping the existing repo-match helper for auto-detection.
- `apps/web/lib/vercel/types.ts` - add a shared Vercel scope schema and update the repo-project lookup response shape so it can distinguish `matchedProjects` from a `savedProject`.
- `apps/web/app/api/vercel/repo-projects/route.ts` - return live repo matches, the remembered repo link, and the accessible scopes needed to seed the fallback picker.
- `apps/web/app/api/vercel/projects/route.ts` - add an authenticated endpoint that lists all accessible projects for a selected scope/team; this is loaded lazily only after the user picks a scope.
- `apps/web/hooks/use-vercel-repo-projects.ts` - update the client contract for the richer lookup response.
- `apps/web/hooks/use-vercel-scope-projects.ts` - add a focused hook for lazy-loading projects for the selected scope.
- `apps/web/components/session-starter.tsx` - preserve the simple single-select UI for matched projects, but when there are zero matches render a two-step scope -> project picker, prefill saved manual links, and keep the existing “Don’t sync env variables” option.
- `apps/web/app/api/sessions/route.ts` - accept explicit selections that are either repo matches or accessible projects in the chosen scope, and upsert the chosen manual link so future repo launches reuse it.
- `apps/web/app/api/vercel/repo-projects/route.test.ts`, `apps/web/app/api/vercel/projects/route.test.ts`, and `apps/web/app/api/sessions/route.test.ts` - cover zero-match fallback, saved manual links, inaccessible scope/project selections, and opt-out behavior.

Verification:
- `bun test apps/web/app/api/vercel/repo-projects/route.test.ts`
- `bun test apps/web/app/api/vercel/projects/route.test.ts`
- `bun test apps/web/app/api/sessions/route.test.ts`
- `bun run ci`
- UI checks: zero repo matches requires scope then project (or explicit opt-out); a saved manual link prefills the next session; one-match and multi-match repo flows still behave exactly as they do now.