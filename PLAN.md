Summary: Add user-configured global skill refs that are saved in preferences, copied onto each new session, installed into the sandbox outside the repo working tree when a new sandbox is created, and merged with repo skills during discovery so repo-local skills still win on name conflicts.

Context:
- Skill discovery currently scans repo-local directories under `.claude/skills` and `.agents/skills`.
- User preferences already persist agent defaults in `user_preferences` and are editable from settings.
- New sessions inherit preference-backed defaults at creation time, which is the right place to snapshot global skill refs.
- Sandbox creation/setup is centralized in the sandbox API.
- `discoverSkills()` keeps the first skill found for a name, so repo-wins behavior depends on scanning repo directories before global directories.

Approach:
- Store explicit `{ source, skillName }` refs in user preferences and snapshot them onto each new session.
- During new sandbox creation for that session, install those refs globally inside the sandbox into `~/.agents/skills`.
- Do not track install manifests or reinstall on reconnect; rely on sandbox persistence/snapshots.
- Discover repo-local skills first and global skills last so project skills override globals with the same slash command.

Changes:
- `apps/web/lib/db/schema.ts` - add `globalSkillRefs` JSONB to `user_preferences` and `sessions`.
- `apps/web/lib/db/user-preferences.ts` - extend defaults/normalization to include `globalSkillRefs`.
- `apps/web/app/api/settings/preferences/route.ts` - accept and validate `globalSkillRefs`.
- `apps/web/hooks/use-user-preferences.ts` - expose `globalSkillRefs` in the client preferences type.
- `apps/web/app/settings/preferences-section.tsx` - add a list editor for repository source + skill name.
- `apps/web/app/api/sessions/route.ts` - copy `preferences.globalSkillRefs` onto `session.globalSkillRefs` when creating a new session.
- `apps/web/lib/sandbox/home-directory.ts` - shared sandbox home-directory resolution helper.
- `apps/web/lib/skills/global-skill-refs.ts` - shared schema/types for global skill refs.
- `apps/web/lib/skills/global-skill-installer.ts` - install refs with `npx skills add <source> --skill <skillName> --agent amp -g -y --copy`.
- `apps/web/app/api/sandbox/route.ts` - call the installer only for new sandbox creation.
- `apps/web/app/api/chat/_lib/runtime.ts` and `apps/web/app/api/sessions/[sessionId]/skills/route.ts` - discover skills from repo-local dirs plus sandbox-global `~/.agents/skills`.

Verification:
- Verify preferences GET/PATCH round-trip `globalSkillRefs`.
- Verify session creation snapshots the current preference refs into the new session record.
- Verify new sandbox creation runs `npx skills add ... --agent amp -g -y --copy` for each ref.
- Verify discovery includes `~/.agents/skills` in addition to repo skill folders.
- Verify duplicate names prefer repo-local skills over global skills.
- Run `bun run ci`.
