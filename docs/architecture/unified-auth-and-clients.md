# Unified Auth and Multi-Client Architecture

## Background

While implementing Slack integration for Open Harness, we encountered a fundamental architecture question: how do multiple clients (web, CLI, Slack) share authentication and access the same underlying agent?

### Initial Problem

When the Slack bot received a message, it tried to create a task with `user_id: "system"`:

```
PostgresError: insert or update on table "tasks" violates foreign key constraint "tasks_user_id_users_id_fk"
detail: "Key (user_id)=(system) is not present in table \"users\"."
```

The tasks table requires a valid user, but Slack messages don't have an associated web app user.

### Evolution of Thinking

1. **First attempt**: Create standalone "slack" provider users when the bot receives messages
   - Problem: These users wouldn't have GitHub tokens for repo operations

2. **Second attempt**: Link Slack users to existing web app users via OAuth
   - Better, but raised the question: what about the CLI? What about other messaging platforms?

3. **Final realization**: We need a unified architecture where all clients authenticate through a single system

## The Problem

We have multiple clients that need to interact with the agent:

| Client                               | Current State              | Auth Needs                    |
| ------------------------------------ | -------------------------- | ----------------------------- |
| **Web App**                          | Works                      | GitHub OAuth, session-based   |
| **CLI**                              | Works (device flow)        | Proxies through web app       |
| **Slack**                            | Not built                  | Needs to link to web user     |
| **Future** (WhatsApp, Discord, etc.) | Not built                  | Same linking pattern as Slack |

Each client needs:

- User identity (who is making the request?)
- GitHub credentials (for repo operations)
- API access (for AI calls)

## Solution: Single Next.js Application

Consolidate everything into one Next.js application that serves all clients.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Next.js Application                       │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Web UI    │  │  AI Proxy   │  │  Webhook Handlers   │  │
│  │  (React)    │  │  (for CLI)  │  │  (Slack, etc.)      │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│                           │                                  │
│                    ┌──────┴──────┐                          │
│                    │  Auth Layer │                          │
│                    │  (unified)  │                          │
│                    └──────┬──────┘                          │
│                           │                                  │
│         ┌─────────────────┼─────────────────┐               │
│         │                 │                 │               │
│    ┌────┴────┐      ┌─────┴─────┐     ┌─────┴─────┐        │
│    │  Users  │      │   Tasks   │     │  Linked   │        │
│    │ (GitHub)│      │ Messages  │     │ Accounts  │        │
│    └─────────┘      └───────────┘     │(Slack,etc)│        │
│                                       └───────────┘        │
└─────────────────────────────────────────────────────────────┘
```

### How Each Client Connects

#### Web Application

- User signs in with GitHub OAuth
- Session stored in cookie
- Direct access to all features

#### CLI

1. User runs `openharness auth login`
2. Opens browser to `https://openharness.dev/auth/cli?code=XXXXX`
3. User approves (already logged in with GitHub)
4. CLI receives session token
5. All AI SDK calls proxy through the web app:
   ```typescript
   const gateway = createGateway({
     baseURL: "https://openharness.dev/api/ai-proxy",
     apiKey: sessionToken,
   });
   ```
6. Web app validates token, injects real API key, forwards to AI provider

#### Slack (and other messaging platforms)

1. User goes to Settings → "Connect Slack" in web app
2. Slack OAuth flow → we get their Slack user ID
3. Store mapping: `slack_user_id` ↔ `web_user_id`
4. When bot receives message:
   - Look up Slack user → find linked web user
   - Use their GitHub token for operations
   - If not linked, reply "Please connect your account at [url]"

### Database Schema

```sql
-- Existing users table (GitHub auth)
users (
  id, provider, external_id, access_token, ...
)

-- New: linked messaging accounts
linked_accounts (
  id,
  user_id        -> users.id,
  provider       (slack, discord, whatsapp, ...),
  external_id    (platform-specific user ID),
  workspace_id   (for Slack workspaces, etc.),
  created_at
)
```

### API Routes Structure

```
app/api/
├── auth/
│   ├── github/callback/     # GitHub OAuth (existing)
│   ├── cli/                 # CLI auth flow
│   └── slack/callback/      # Slack account linking
├── ai-proxy/
│   └── [...path]/           # Proxies AI requests for CLI
├── webhooks/
│   └── slack/               # Receives Slack events
└── tasks/                   # Task management (existing)
```

## Benefits

1. **Single deployment** - One Vercel app, simpler ops
2. **Unified auth** - All clients share the same user identity
3. **Centralized billing** - All AI calls flow through one place
4. **Consistent experience** - Tasks created in CLI appear in web and vice versa
5. **Easier to extend** - Adding WhatsApp/Discord follows the same pattern as Slack

## Migration Steps

1. [x] Create `linked_accounts` and `cli_tokens` tables
2. [ ] Add Slack OAuth flow for account linking
3. [ ] Implement Slack webhook handler (`/api/webhooks/slack`)
4. [x] Implement AI proxy route for CLI (`/api/ai-proxy`)
5. [x] Implement CLI auth flow

## Implementation Status

### Completed

#### Database Layer
- **Schema**: `linked_accounts` and `cli_tokens` tables in `apps/web/lib/db/schema.ts`
- **Migration**: `0010_far_shiva.sql` adds both tables
- **CLI Tokens Module** (`apps/web/lib/db/cli-tokens.ts`):
  - Device flow management (start, poll, verify)
  - Token verification and user lookup
  - Token revocation and cleanup
- **Linked Accounts Module** (`apps/web/lib/db/linked-accounts.ts`):
  - CRUD operations for linked accounts

#### CLI Authentication (`apps/cli/auth/`)
- **Commands** (`commands.ts`): `login`, `logout`, `status`, `whoami`
- **Credentials** (`credentials.ts`): Local storage at `~/.config/open-harness/credentials.json`
- **Device Flow** (`device-flow.ts`): OAuth 2.0 device authorization grant
- **Config** (`config.ts`): Dev/prod URL switching via `NODE_ENV` or `OPEN_HARNESS_URL`

#### Web App API Routes
- `POST /api/cli/auth/device` - Start device flow, returns device code + user code
- `POST /api/cli/auth/token` - Poll for token (authorization_pending → access_token)
- `POST /api/cli/auth/verify` - Web UI calls this to authorize a device code
- `GET /api/cli/auth/me` - Get user info from access token
- `POST /api/ai-proxy/[...path]` - Proxies AI requests to Vercel AI Gateway

#### Web App UI
- `/cli/auth` page - User enters device code to authorize CLI

#### Agent & TUI Integration
- `createProxyGateway()` in `packages/agent/proxy-gateway.ts`
- Gateway function passed through TUI → Transport → Model selection
- CLI requires auth; creates proxy gateway when authenticated

### Remaining Work

#### Slack Integration (not started)
- Slack OAuth flow for account linking (Settings → Connect Slack)
- Webhook handler at `/api/webhooks/slack`
- Lookup linked user when bot receives message

## Open Questions

- **Function timeouts**: Currently using `maxDuration: 300` (5 min) for the AI proxy. May need background jobs for very long tasks.
- **CLI offline mode**: Should CLI work without auth for local-only use cases? Currently requires auth.
- **Rate limiting**: How to handle usage limits per user?
- **Token refresh**: CLI tokens expire after 90 days. Consider auto-refresh or better UX for re-auth.
