# User AI Gateway & Connections — Implementation Plan

## Goal

Allow users to log in to Open Harness with their Vercel account, go through a
three-step onboarding flow (`/onboarding`), and have their AI usage billed to
the Vercel team they select — using the Vercel AI Gateway scoped to that team —
instead of the default Vercel Labs deployment gateway.

## Background

### How nanobananapro does it

nanobananapro (Vercel's internal image generation app) implements user-scoped
billing via the Vercel AI Gateway:

1. User logs in with Vercel OAuth.
2. The user's **Vercel access token** (PAT) is exchanged for a **team-scoped AI
   Gateway API key** via `POST https://api.vercel.com/api-keys?teamId={teamId}`
   with body `{ purpose: "ai-gateway", name: "...", exchange: true }`.
3. The API key is stored in the session alongside `teamId` / `teamSlug`.
4. `createGateway({ apiKey })` from `@ai-sdk/gateway` is used with that key so
   all model calls are billed to the selected team.
5. Keys are refreshed proactively (every 4 hours) and reactively on 401/403.

### How Open Harness works today

- Primary auth: Vercel OAuth (PKCE) → `users` table with encrypted tokens.
- Secondary auth: GitHub App OAuth → `accounts` table.
- AI models: `gateway()` wrapper in `packages/agent/models.ts` that falls back
  to the default AI SDK `gateway` (Vercel Labs billing).
- No onboarding flow exists.
- No team selection or gateway key concept exists.
- The `gateway()` wrapper already supports `GatewayConfig { baseURL, apiKey }`
  but it's never used with user-scoped keys.

## Architecture

### Data Model Changes

Add columns to `user_preferences` (existing table, single-row-per-user):

```sql
ALTER TABLE user_preferences
  ADD COLUMN vercel_team_id TEXT,
  ADD COLUMN vercel_team_slug TEXT,
  ADD COLUMN gateway_api_key TEXT,          -- encrypted at rest
  ADD COLUMN gateway_api_key_obtained_at TIMESTAMP,
  ADD COLUMN onboarding_completed_at TIMESTAMP;
```

**Why `user_preferences` not `users`?** The team/gateway selection is a user
preference, not an identity attribute. Keeping it here avoids schema changes to
the core auth table and matches the existing pattern.

### Gateway Key Flow

```
User selects team → POST /api/vercel/gateway-key { teamId }
  → Server: get user's Vercel access token (auto-refresh if expired)
  → Server: POST https://api.vercel.com/api-keys?teamId={teamId}
            body: { purpose: "ai-gateway", name: "Open Harness Gateway Key", exchange: true }
  → Server: encrypt(apiKey) → store in user_preferences
  → Server: return { success: true }

On chat start → load user_preferences → if gateway_api_key exists:
  → decrypt → pass as GatewayConfig to agent's gateway()
  → AI usage billed to user's selected team
```

### Key Refresh Strategy

- **Proactive**: If `gateway_api_key_obtained_at` > 4 hours ago, refresh before
  use (matches nanobananapro's pattern).
- **Reactive**: On 401/403 from gateway, refresh and retry once.
- **On team change**: Delete old key, exchange new one immediately.

### Onboarding Flow (`/onboarding`)

Three-step accordion:

1. **Select Vercel Team** — Lists all teams the user belongs to. User picks one
   for billing. Exchanges token for gateway key immediately on selection.
2. **Connect GitHub** — Shows GitHub App installation status. Install button if
   not connected. Can skip (GitHub is optional for some workflows).
3. **Model Preferences** — Default model selection, enabled models. Reuses
   existing preferences patterns.

Users who have already completed onboarding skip to `/` on visit.
New users are redirected to `/onboarding` after first login.

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `apps/web/lib/vercel/teams.ts` | Fetch user's Vercel teams from API |
| `apps/web/lib/vercel/gateway-key.ts` | Exchange token for gateway API key, refresh logic |
| `apps/web/lib/vercel/api-client.ts` | Shared typed Vercel API fetch helper (extracted from projects.ts) |
| `apps/web/app/api/vercel/teams/route.ts` | GET — list user's accessible teams |
| `apps/web/app/api/vercel/gateway-key/route.ts` | POST — exchange token for team-scoped gateway key |
| `apps/web/app/api/onboarding/status/route.ts` | GET — check if onboarding completed |
| `apps/web/app/api/onboarding/complete/route.ts` | POST — mark onboarding done |
| `apps/web/app/onboarding/page.tsx` | Onboarding page (server component) |
| `apps/web/app/onboarding/onboarding-flow.tsx` | Client component with 3-step accordion |
| `apps/web/lib/db/migrations/0029_*.sql` | Migration for new columns |

### Modified Files

| File | Change |
|------|--------|
| `apps/web/lib/db/schema.ts` | Add 5 new columns to `userPreferences` |
| `apps/web/lib/db/user-preferences.ts` | Add gateway/team fields to data type and queries |
| `packages/agent/models.ts` | No changes needed (already supports `GatewayConfig`) |
| `apps/web/app/workflows/chat.ts` | Pass gateway config from user prefs to agent options |
| `apps/web/app/api/chat/route.ts` | Load gateway config, pass through to workflow |
| `apps/web/app/api/auth/vercel/callback/route.ts` | Redirect new users to `/onboarding` |
| `apps/web/lib/vercel/projects.ts` | Refactor to use shared `api-client.ts` |

### lib/vercel/* Organization (after changes)

```
lib/vercel/
├── api-client.ts       # Shared typed fetch helper for Vercel API
├── oauth.ts            # OAuth PKCE flow (existing, unchanged)
├── token.ts            # Token management & refresh (existing, unchanged)
├── teams.ts            # NEW: List teams, get team details
├── gateway-key.ts      # NEW: Exchange token for gateway key, refresh
├── projects.ts         # Existing: project/deployment queries (refactored)
└── types.ts            # Existing + new team/gateway types
```

### lib/github/* Organization (after changes)

The existing GitHub abstractions are already well-organized. `client.ts` is
large (1481 lines) but splitting it is out of scope for this PR — it would be a
separate refactor. The key improvement is adding proper barrel exports:

```
lib/github/
├── api.ts                  # REST helpers (existing)
├── app-auth.ts             # GitHub App JWT auth (existing)
├── auth-url.ts             # Token-authenticated URL builder (existing)
├── client.ts               # Octokit wrapper (existing, large but cohesive)
├── connection-status.ts    # Connection status types (existing)
├── installation-repos.ts   # List repos for installation (existing)
├── installation-url.ts     # Install URL builder (existing)
├── installations-sync.ts   # Sync installations to DB (existing)
├── repo-identifiers.ts     # Repo identifier utils (existing)
├── user-token.ts           # GitHub token management (existing)
└── index.ts                # NEW: Clean barrel exports with JSDoc
```

## Implementation Order

1. DB schema changes + migration
2. `lib/vercel/api-client.ts` — shared fetch helper
3. `lib/vercel/teams.ts` — team listing
4. `lib/vercel/gateway-key.ts` — gateway key exchange + refresh
5. `lib/vercel/types.ts` — extended types
6. `lib/github/index.ts` — barrel exports
7. API routes (`/api/vercel/teams`, `/api/vercel/gateway-key`, `/api/onboarding/*`)
8. Onboarding page + accordion UI
9. Wire gateway config through chat route → workflow → agent
10. Auth callback redirect for new users
11. Verify: typecheck, lint, build

## Security Considerations

- Gateway API keys are **encrypted at rest** using the existing `encrypt()`
  utility (AES-256 via `ENCRYPTION_KEY`).
- Keys are **never sent to the client** — only the team selection (id/slug) is
  exposed via API responses.
- The exchange endpoint validates the authenticated user before making the
  Vercel API call.
- Gateway keys are **team-scoped** — they can only bill to the team the user
  selected and has membership in.

## Open Questions

- **Fallback behavior**: If a user hasn't completed onboarding (no gateway key),
  should we fall back to the default gateway (Vercel Labs billing) or block
  usage? → **Decision: Fall back to default gateway** for backward
  compatibility. The onboarding is encouraged but not mandatory.
- **Team switching**: Should users be able to change their billing team after
  onboarding? → **Decision: Yes**, via Settings > Connections page. The
  onboarding is just the first-time setup.
