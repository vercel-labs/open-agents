# Teams Migration Plan

## Overview

Migrate Open Harness from a single-user ownership model to a team-based model where every resource belongs to a team. Every user automatically gets a personal team on signup. Users can create additional teams and invite members. Team context is resolved via a cookie (no URL changes).

### Design Decisions (Confirmed)

| Decision | Choice |
|---|---|
| URL routing | **Context cookie** — active team stored in cookie, no URL path changes |
| Personal team | **Auto-create** — every user gets a personal team on signup |
| Roles | **Owner + Member** — simple two-role model |
| Session visibility | **All team sessions** — every member sees all sessions in the team |

---

## Phase 1: Database Schema Changes

### New Tables

#### `teams`
```ts
export const teams = pgTable("teams", {
  id: text("id").primaryKey(),                    // nanoid
  name: text("name").notNull(),                   // Display name (e.g. "Acme Inc" or "alice's team")
  slug: text("slug").notNull().unique(),          // URL-safe identifier
  isPersonal: boolean("is_personal").notNull().default(false), // True for auto-created personal teams
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

#### `team_members`
```ts
export const teamMembers = pgTable(
  "team_members",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "member"] }).notNull().default("member"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("team_members_team_user_idx").on(table.teamId, table.userId),
  ],
);
```

#### `team_invitations` (optional, phase 2+)
```ts
export const teamInvitations = pgTable("team_invitations", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role", { enum: ["owner", "member"] }).notNull().default("member"),
  invitedBy: text("invited_by").notNull().references(() => users.id),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

### Modified Tables

#### `sessions` — add `teamId`
```sql
ALTER TABLE sessions ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE CASCADE;
-- Backfill: set team_id to the user's personal team for all existing sessions
-- Then make NOT NULL:
ALTER TABLE sessions ALTER COLUMN team_id SET NOT NULL;
```

#### `usage_events` — add `teamId`
```sql
ALTER TABLE usage_events ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE CASCADE;
-- Backfill same as sessions
ALTER TABLE usage_events ALTER COLUMN team_id SET NOT NULL;
```

#### `github_installations` — add `teamId`
```sql
ALTER TABLE github_installations ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE CASCADE;
-- Backfill to personal team
ALTER TABLE github_installations ALTER COLUMN team_id SET NOT NULL;
```

#### `user_preferences` — consider adding team-scoped preferences later
No change in Phase 1. User preferences remain per-user. Team-level defaults can be a follow-up.

### Migration Script

A Drizzle migration that:
1. Creates `teams` and `team_members` tables
2. Adds nullable `team_id` columns to `sessions`, `usage_events`, `github_installations`
3. Runs a data migration:
   - For each existing user, create a personal team (`is_personal = true`, slug = username)
   - Insert a `team_members` row with `role = "owner"`
   - Backfill `team_id` on all existing sessions, usage_events, and github_installations
4. Makes `team_id` columns NOT NULL

**File changes:**
- `apps/web/lib/db/schema.ts` — add `teams`, `teamMembers` table definitions; add `teamId` to `sessions`, `usageEvents`, `githubInstallations`
- `apps/web/lib/db/migrations/` — new migration file
- `apps/web/drizzle.config.ts` — no change needed (already points to schema)

---

## Phase 2: Auth & Session Context

### Active Team in Cookie

Store the active team ID in a separate cookie (`_active_team_`), or extend the existing JWE session cookie.

**Recommended: separate cookie** — simpler, doesn't require re-encrypting the JWE on team switch.

```ts
// lib/team-context.ts
import { cookies } from "next/headers";

const ACTIVE_TEAM_COOKIE = "_active_team_";

export async function getActiveTeamId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(ACTIVE_TEAM_COOKIE)?.value ?? null;
}

export async function setActiveTeamId(teamId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_TEAM_COOKIE, teamId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });
}
```

### Resolving Active Team

Create a helper that resolves the current team context for every request:

```ts
// lib/team-context.ts (continued)
export async function getActiveTeam(userId: string): Promise<Team> {
  const teamId = await getActiveTeamId();

  if (teamId) {
    // Verify user is a member of this team
    const membership = await getTeamMembership(teamId, userId);
    if (membership) {
      const team = await getTeamById(teamId);
      if (team) return team;
    }
  }

  // Fallback: user's personal team
  const personalTeam = await getPersonalTeam(userId);
  await setActiveTeamId(personalTeam.id);
  return personalTeam;
}
```

### Extend Auth Session Type

```ts
// lib/session/types.ts — no change needed
// Team context is resolved separately, not stored in the JWE
```

**File changes:**
- New file: `apps/web/lib/team-context.ts`
- `apps/web/lib/session/get-server-session.ts` — optionally export a combined `getSessionWithTeam()` helper

---

## Phase 3: Data Access Layer

### New DB Access Functions

Create `apps/web/lib/db/teams.ts`:

```ts
// Core CRUD
createTeam(data: NewTeam): Promise<Team>
getTeamById(teamId: string): Promise<Team | undefined>
getTeamBySlug(slug: string): Promise<Team | undefined>
getPersonalTeam(userId: string): Promise<Team>
getTeamsByUserId(userId: string): Promise<(Team & { role: string })[]>
updateTeam(teamId: string, data: Partial<Team>): Promise<Team>
deleteTeam(teamId: string): Promise<void>

// Membership
addTeamMember(teamId: string, userId: string, role: "owner" | "member"): Promise<TeamMember>
removeTeamMember(teamId: string, userId: string): Promise<void>
getTeamMembers(teamId: string): Promise<(TeamMember & { user: User })[]>
getTeamMembership(teamId: string, userId: string): Promise<TeamMember | undefined>
updateTeamMemberRole(teamId: string, userId: string, role: string): Promise<TeamMember>

// Personal team creation (called during signup)
createPersonalTeam(userId: string, username: string): Promise<Team>
```

### Modified DB Access Functions

**`apps/web/lib/db/sessions.ts`** — the most impacted file:

| Current function | Change |
|---|---|
| `getSessionsByUserId(userId)` | Replace with `getSessionsByTeamId(teamId)` |
| `getSessionsWithUnreadByUserId(userId)` | Change to `getSessionsWithUnreadByTeamId(teamId, userId)` — team scopes sessions, userId still needed for unread tracking |
| `getUsedSessionTitles(userId)` | Change to `getUsedSessionTitles(teamId)` |
| `createSession(data)` | Ensure `teamId` is included in `NewSession` |
| `createSessionWithInitialChat(input)` | Ensure `teamId` is included |

**`apps/web/lib/db/usage.ts`**:

| Current function | Change |
|---|---|
| `recordUsage(userId, data)` | Add `teamId` parameter |
| `getUsageHistory(userId)` | Add option to query by `teamId` for team-level usage view |

**`apps/web/lib/db/github-installations.ts`** (if exists):
- Scope installations to team rather than user where appropriate

---

## Phase 4: Authorization Overhaul

### Current Pattern (26 occurrences)
```ts
if (sessionRecord.userId !== session.user.id) {
  return new Response("Forbidden", { status: 403 });
}
```

### New Pattern
```ts
// Replace direct userId check with team membership check
const team = await getActiveTeam(session.user.id);
if (sessionRecord.teamId !== team.id) {
  return new Response("Forbidden", { status: 403 });
}
```

### Implementation Strategy

Create a reusable authorization helper:

```ts
// lib/auth/authorize-session.ts
export async function authorizeSessionAccess(
  sessionRecord: { teamId: string },
  userId: string,
): Promise<{ authorized: true; team: Team } | { authorized: false }> {
  const team = await getActiveTeam(userId);
  if (sessionRecord.teamId !== team.id) {
    return { authorized: false };
  }
  return { authorized: true, team };
}
```

### Files Requiring Auth Changes (26 files)

Every file below contains the `sessionRecord.userId !== session.user.id` check:

**API routes (22 files):**
1. `app/api/chat/[chatId]/stop/route.ts`
2. `app/api/chat/[chatId]/stream/route.ts`
3. `app/api/chat/route.ts`
4. `app/api/generate-pr/route.ts`
5. `app/api/git-status/route.ts`
6. `app/api/github/create-repo/route.ts`
7. `app/api/pr/route.ts`
8. `app/api/sandbox/extend/route.ts`
9. `app/api/sandbox/reconnect/route.ts`
10. `app/api/sandbox/route.ts` (2 occurrences)
11. `app/api/sandbox/snapshot/route.ts` (2 occurrences)
12. `app/api/sandbox/status/route.ts`
13. `app/api/sessions/[sessionId]/chats/[chatId]/read/route.ts`
14. `app/api/sessions/[sessionId]/chats/[chatId]/route.ts` (2 occurrences)
15. `app/api/sessions/[sessionId]/chats/route.ts` (2 occurrences)
16. `app/api/sessions/[sessionId]/diff/cached/route.ts`
17. `app/api/sessions/[sessionId]/diff/route.ts`
18. `app/api/sessions/[sessionId]/files/route.ts`
19. `app/api/sessions/[sessionId]/route.ts` (3 occurrences — GET, PATCH, DELETE)
20. `app/api/sessions/[sessionId]/share/route.ts` (2 occurrences)
21. `app/api/sessions/[sessionId]/skills/route.ts`
22. `app/api/sessions/route.ts` — change to query by teamId

**Server components (3 files):**
23. `app/sessions/[sessionId]/layout.tsx`
24. `app/sessions/[sessionId]/page.tsx`
25. `app/sessions/[sessionId]/chats/[chatId]/page.tsx`

---

## Phase 5: Signup Flow Changes

### Current Flow
1. User authenticates via Vercel/GitHub OAuth
2. User record created/updated in `users` table
3. Session cookie set

### New Flow
1. User authenticates via Vercel/GitHub OAuth
2. User record created/updated in `users` table
3. **If new user**: Create personal team + team_members row
4. **Set active team cookie** to personal team
5. Session cookie set

**File changes:**
- `apps/web/app/api/auth/vercel/callback/route.ts` — after user upsert, create personal team if new user
- `apps/web/app/api/auth/signin/github/route.ts` — same (if GitHub can be primary auth)

---

## Phase 6: API Route Updates

### Session Creation (`POST /api/sessions`)
```diff
- userId: session.user.id,
+ userId: session.user.id,
+ teamId: team.id,
```

### Session Listing (`GET /api/sessions`)
```diff
- const sessions = await getSessionsWithUnreadByUserId(session.user.id);
+ const team = await getActiveTeam(session.user.id);
+ const sessions = await getSessionsWithUnreadByTeamId(team.id, session.user.id);
```

### Usage Recording (`POST /api/chat`)
```diff
- void recordUsage(session.user.id, { ... });
+ void recordUsage(session.user.id, team.id, { ... });
```

### Usage History (`GET /api/usage`)
```diff
- const usage = await getUsageHistory(session.user.id);
+ const team = await getActiveTeam(session.user.id);
+ const usage = await getUsageHistory(team.id); // or userId for personal view
```

---

## Phase 7: UI Changes

### Team Switcher Component

Add a dropdown in the app header/sidebar that shows all teams the user belongs to and allows switching.

```
┌─────────────────────┐
│ 🏠 alice (Personal) │  ← current
│ 🏢 Acme Inc         │
│ 🏢 Side Project     │
│ ──────────────────  │
│ + Create Team       │
└─────────────────────┘
```

Switching teams:
- `POST /api/teams/switch` — sets the `_active_team_` cookie
- Client revalidates / reloads session list

**File changes:**
- New component: `apps/web/components/team-switcher.tsx`
- Modified: `apps/web/components/sidebar.tsx` (or equivalent header/nav) — add team switcher

### Team Settings Pages

New routes under `/settings/team`:
- `/settings/team` — Team name, slug, delete team
- `/settings/team/members` — List members, invite, remove, change roles

**File changes:**
- New: `apps/web/app/settings/team/page.tsx`
- New: `apps/web/app/settings/team/members/page.tsx`
- Modified: `apps/web/app/settings/layout.tsx` — add "Team" section to settings nav

### Home Page

The home page (`apps/web/app/home-page.tsx`) currently shows the user's sessions. It should now show the active team's sessions, with the creator's avatar/name on each session card.

**File changes:**
- Modified: `apps/web/app/home-page.tsx` — fetch by teamId, show creator info
- Modified: session list/card components — show who created the session

### New API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/teams` | GET | List user's teams |
| `/api/teams` | POST | Create a new team |
| `/api/teams/[teamId]` | GET | Get team details |
| `/api/teams/[teamId]` | PATCH | Update team (name, slug) |
| `/api/teams/[teamId]` | DELETE | Delete team (owner only, not personal) |
| `/api/teams/[teamId]/members` | GET | List team members |
| `/api/teams/[teamId]/members` | POST | Add member / send invitation |
| `/api/teams/[teamId]/members/[userId]` | PATCH | Update member role |
| `/api/teams/[teamId]/members/[userId]` | DELETE | Remove member |
| `/api/teams/switch` | POST | Set active team cookie |

---

## Implementation Order & Effort Estimates

| Phase | Description | Effort | Dependencies |
|---|---|---|---|
| **1** | DB schema + migration + backfill | **M** | None |
| **2** | Auth/cookie team context | **S** | Phase 1 |
| **3** | Data access layer (teams.ts, modify sessions.ts, usage.ts) | **M** | Phase 1 |
| **4** | Authorization overhaul (26 files) | **L** | Phases 2, 3 |
| **5** | Signup flow (auto personal team) | **S** | Phases 1, 2 |
| **6** | API route updates (session creation, listing, usage) | **M** | Phases 3, 4 |
| **7** | UI (team switcher, settings pages, home page) | **L** | Phases 2, 6 |

**S** = Small (< 1 day), **M** = Medium (1-2 days), **L** = Large (2-4 days)

**Total estimate: ~2 weeks of focused work**

> **Note:** The CLI (`apps/cli/`) is out of scope for this migration. CLI sessions will continue to be created against the user's personal team implicitly — no CLI code changes required.

---

## Risks & Considerations

1. **Data migration safety**: The backfill migration must be tested against a staging database first. It modifies every row in `sessions` and `usage_events`.

2. **Cookie-based team context**: If the cookie is missing or stale (team deleted, membership revoked), the system must gracefully fall back to the personal team. Every `getActiveTeam()` call already handles this.

3. **GitHub installations**: Currently scoped to userId. When a team member installs the GitHub app, it should benefit the whole team. This needs careful design — the installation's access token is user-specific, but the installation *association* should be team-scoped.

4. **Session ownership vs. team membership**: Even within a team, individual sessions still track `userId` (the creator). This is needed for:
   - Knowing who created a session
   - GitHub token resolution (using the creator's linked GitHub account for repo access)
   - Audit trail

5. **Personal team deletion**: Personal teams should never be deletable. Enforce in both API and UI.

6. **Slug uniqueness**: Team slugs must be globally unique. Personal team slugs can default to the username, but need collision handling if a username conflicts with an existing team slug.

7. **Leaving a team**: If the owner leaves, the team must be transferred or deleted. An owner cannot leave without transferring ownership first.

8. **No billing yet**: The current system has no billing. When billing is added, it should be scoped to the team level (team pays for all members' usage). The `usage_events.team_id` column prepares for this.
