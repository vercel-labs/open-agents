Summary: Add user-configured global skill refs that are saved in preferences, copied onto each new session, installed into the sandbox outside the repo working tree, and merged with repo skills during discovery so repo-local skills still win on name conflicts.

Context:
- Skill discovery currently only scans repo-local directories under `.claude/skills` and `.agents/skills`.
  - `apps/web/app/api/chat/_lib/runtime.ts`
  - `apps/web/app/api/sessions/[sessionId]/skills/route.ts`
- User preferences already persist agent defaults in `user_preferences` and are editable from settings.
  - `apps/web/lib/db/schema.ts`
  - `apps/web/lib/db/user-preferences.ts`
  - `apps/web/app/api/settings/preferences/route.ts`
  - `apps/web/hooks/use-user-preferences.ts`
  - `apps/web/app/settings/preferences-section.tsx`
- New sessions already inherit preference-backed defaults at creation time, which is the right place to snapshot “new sessions only” global skill refs.
  - `apps/web/app/api/sessions/route.ts`
- Sandbox creation/setup is centralized in the sandbox API, and sandbox home resolution logic already exists for Vercel CLI auth setup.
  - `apps/web/app/api/sandbox/route.ts`
  - `apps/web/lib/sandbox/vercel-cli-auth.ts`
- `discoverSkills()` keeps the first skill found for a name and ignores later duplicates, so repo-wins behavior depends on scanning repo directories before global directories.
  - `packages/agent/skills/discovery.ts`
- I verified the skills CLI behavior with a temporary isolated HOME: `npx skills add <source> --skill <name> --agent amp -g -y --copy` installs into `~/.agents/skills/<skill>`, which fits the requested separate non-repo sandbox location.

Approach: Store explicit `{ source, skillName }` refs in user preferences and also snapshot them onto each new session. During sandbox setup for that session, install those refs globally inside the sandbox with the skills CLI into `~/.agents/skills`, then discover repo-local skills first and global skills last so project skills override globals with the same slash command.

Changes:
- `apps/web/lib/db/schema.ts`
  - Add `globalSkillRefs` JSONB to `user_preferences`.
  - Add `globalSkillRefs` JSONB to `sessions` so each session snapshots the preference value at creation time.
- `apps/web/lib/db/migrations/<generated>.sql`
  - Generated migration for the two new JSONB columns.
- `apps/web/lib/db/user-preferences.ts`
  - Extend `UserPreferencesData` defaults/normalization to include `globalSkillRefs`.
- `apps/web/lib/skills/global-skill-refs.ts`
  - New shared Zod schema + types for a single ref `{ source, skillName }` and helpers to normalize/validate arrays.
  - Add small helpers for shell escaping and stable comparison/hash if needed for install caching.
- `apps/web/app/api/settings/preferences/route.ts`
  - Accept and validate `globalSkillRefs` in GET/PATCH.
- `apps/web/hooks/use-user-preferences.ts`
  - Expose `globalSkillRefs` in the client preferences type.
- `apps/web/app/settings/preferences-section.tsx`
  - Add a simple list editor for global skills with rows for repository source and skill name, plus add/remove actions.
- `apps/web/app/api/sessions/route.ts`
  - Copy `preferences.globalSkillRefs` onto `session.globalSkillRefs` when creating a new session.
- `apps/web/lib/sandbox/home-directory.ts`
  - Extract/reuse sandbox home-directory resolution so both Vercel auth sync and global skill install can share it.
- `apps/web/lib/skills/global-skill-installer.ts`
  - New helper that installs a session’s `globalSkillRefs` inside the sandbox using `npx skills add <source> --skill <skillName> --agent amp -g -y --copy`.
  - Write a small per-session manifest under a non-repo path (for example under `~/.open-harness/`) so repeated reconnects/setup can cheaply skip reinstall when the same refs were already applied.
- `apps/web/app/api/sandbox/route.ts`
  - Call the global-skill installer after sandbox creation/setup for sessions that have refs.
  - Keep installation outside the repo working tree.
- `apps/web/app/api/chat/_lib/runtime.ts`
  - Discover skills from repo-local directories plus sandbox-global `~/.agents/skills`, with repo directories first so repo skills win on duplicate names.
- `apps/web/app/api/sessions/[sessionId]/skills/route.ts`
  - Use the same expanded discovery directories for the slash-command suggestion endpoint.
- Tests to update/add:
  - `apps/web/lib/db/user-preferences.test.ts`
  - `apps/web/app/api/settings/preferences/route.test.ts`
  - `apps/web/app/api/sessions/route.test.ts`
  - `apps/web/app/api/sessions/[sessionId]/skills/route.test.ts`
  - `apps/web/app/api/chat/route.test.ts` or a focused runtime test if that code path is easier to cover
  - New tests for `apps/web/lib/skills/global-skill-refs.ts`
  - New tests for `apps/web/lib/skills/global-skill-installer.ts`

Verification:
- Data model / API:
  - Verify preferences GET/PATCH round-trip `globalSkillRefs`.
  - Verify session creation snapshots the current preference refs into the new session record.
- Sandbox/runtime:
  - Verify installer runs `npx skills add ... --agent amp -g -y --copy` for each ref and skips when manifest already matches.
  - Verify discovery includes `~/.agents/skills` in addition to repo skill folders.
  - Verify duplicate names prefer repo-local skills over global skills.
- Commands:
  - `bun run --cwd apps/web db:generate` (after schema change)
  - `bun run ci`
- Edge cases:
  - Empty global skill list
  - Invalid/malformed refs rejected by settings API
  - Duplicate refs normalized or deduplicated before persistence
  - Existing sessions remain unchanged after a user updates preferences
