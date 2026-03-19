Summary: Recreate the Vercel-aware repo session flow by adding a server-side Vercel project/env helper, repo-level remembered Vercel project links, session-level Vercel project snapshots, a repo-to-project lookup API, and sandbox-time `.env.local` sync. Keep the implementation aligned with the existing session creation, Drizzle schema, and sandbox lifecycle patterns that already exist in `apps/web`.

Context: `apps/web/app/api/sessions/route.ts` is the main session creation entrypoint and currently only persists repo metadata plus sandbox preferences. `apps/web/app/[username]/[repo]/page.tsx` creates repo-backed sessions directly and needs to stay consistent with the main flow. `apps/web/app/api/sandbox/route.ts` already has the exact “first create vs reconnect” split where sandbox-only work should happen; that is the right place to add non-blocking `.env.local` sync. Vercel OAuth/token plumbing already exists in `apps/web/lib/vercel/oauth.ts` and `apps/web/lib/vercel/token.ts`, but there is no project/env helper or repo-project API yet. Drizzle schema lives in `apps/web/lib/db/schema.ts`, migrations are generated from there, and focused DB helpers live under `apps/web/lib/db/`.

Approach: Add a small shared Vercel helper for matching projects by GitHub repo URL, retrieving project env vars, reducing them to a deterministic Development-only snapshot, and serializing `.env.local` content. Persist remembered repo defaults in a new table and copy immutable Vercel project fields onto each session record. In the session starter, only fetch/show Vercel project choices for Vercel-authenticated repo flows; use the lookup API to preselect remembered defaults or a single live match, require an explicit choice only when multiple candidates exist, and preserve the API’s `undefined` vs `null` vs object semantics in the session creation route.

Changes:
- `apps/web/lib/vercel/projects.ts` - add server-side helpers to list repo-matching Vercel projects across personal/team scopes, fetch project env vars, select deterministic Development values, and serialize `.env.local` content.
- `apps/web/lib/vercel/types.ts` - add shared Zod-backed types for Vercel project selection and repo-project lookup responses so client/server code can share contracts without importing server-only modules.
- `apps/web/lib/db/schema.ts` - add repo-level `vercel_project_links` persistence plus session snapshot columns (`vercelProjectId`, `vercelProjectName`, `vercelTeamId`, `vercelTeamSlug`).
- `apps/web/lib/db/vercel-project-links.ts` - add focused helpers to normalize repo keys, fetch remembered links, and upsert a remembered repo→project default.
- `apps/web/app/api/vercel/repo-projects/route.ts` - add an authenticated lookup route that returns live candidates and the default project selection for a repo.
- `apps/web/hooks/use-vercel-repo-projects.ts` - add a focused client hook for the session starter to load repo-project matches without bloating the component.
- `apps/web/components/session-starter.tsx` - wire Vercel project lookup/selection into repo-backed session creation, including loading, multi-match selection, and explicit “don’t sync env vars” handling.
- `apps/web/hooks/use-sessions.ts`, `apps/web/app/home-page.tsx`, `apps/web/components/new-session-dialog.tsx` - pass the optional Vercel project payload through the existing create-session client flow.
- `apps/web/app/api/sessions/route.ts` - accept `vercelProject?: VercelProjectSelection | null`, preserve the tri-state semantics, upsert remembered repo defaults on explicit project choices, and snapshot the resolved Vercel project fields onto the session.
- `apps/web/app/[username]/[repo]/page.tsx` - apply any remembered repo-level Vercel link when repo pages auto-create a session.
- `apps/web/app/api/sandbox/route.ts` - on first sandbox creation only, fetch Development env vars for the linked session project, generate `.env.local`, write it through the sandbox abstraction, and log failures without blocking startup.
- `apps/web/app/api/vercel/repo-projects/route.test.ts` - cover remembered default selection and single-match auto-selection.
- `apps/web/app/api/sessions/route.test.ts` - cover explicit project persistence+memory, omitted project fallback, and explicit `null` suppression.
- `apps/web/app/api/sandbox/route.test.ts` - extend the lifecycle tests to cover `.env.local` sync on first create, no resync on reconnect, and non-blocking sync failures.
- `apps/web/lib/vercel/projects.test.ts` - cover candidate dedupe, Development env filtering precedence, and dotenv escaping/ordering.
- `apps/web/lib/db/migrations/*` - generate and commit the new Drizzle migration and metadata snapshot after schema changes.

Verification:
- If `node_modules` is missing, run `bun install`.
- Run targeted tests while iterating:
  - `bun test apps/web/lib/vercel/projects.test.ts`
  - `bun test apps/web/app/api/vercel/repo-projects/route.test.ts`
  - `bun test apps/web/app/api/sessions/route.test.ts`
  - `bun test apps/web/app/api/sandbox/route.test.ts`
- Generate the migration with `bun run --cwd apps/web db:generate` and confirm `bun run --cwd apps/web db:check` passes.
- Run full required verification from the repo root: `bun run ci`.
- Edge cases to confirm: saved repo defaults are case-insensitive; multiple scope lookups tolerate partial failures; explicit “don’t sync” does not erase the remembered default; reconnects do not rewrite `.env.local`; failed env sync does not fail sandbox creation.