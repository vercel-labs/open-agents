Summary: Add support for user-configured global skill refs that are installed into each sandbox/session outside the repo working tree, surfaced in preferences, and merged with repo skills for discovery.

Context:
- Session/runtime skill discovery currently only scans repo-local directories under `.claude/skills` and `.agents/skills`.
  - `apps/web/app/api/chat/_lib/runtime.ts`
  - `apps/web/app/api/sessions/[sessionId]/skills/route.ts`
- User preferences already back default session settings through `user_preferences`, exposed via `/api/settings/preferences` and rendered in the settings UI.
  - `apps/web/lib/db/schema.ts`
  - `apps/web/lib/db/user-preferences.ts`
  - `apps/web/app/api/settings/preferences/route.ts`
  - `apps/web/hooks/use-user-preferences.ts`
  - `apps/web/app/settings/preferences-section.tsx`
- New sessions already inherit user preferences at creation time.
  - `apps/web/app/api/sessions/route.ts`
  - `apps/web/components/session-starter.tsx`
- Sandbox creation/reconnect hooks are centralized in the sandbox API, which is the best place to install non-repo global skills.
  - `apps/web/app/api/sandbox/route.ts`
- Skill discovery deduplicates by name in directory order, so discovery order will define whether repo-local or global skills win on conflicts.
  - `packages/agent/skills/discovery.ts`

Approach: Pending clarification on install location/apply timing/conflict behavior.

Changes:
- Pending final design after clarification.

Verification:
- Pending final design after clarification.
