# AGENTS.md

This file provides guidance for AI coding agents working in this repository.

**This is a living document.** When you make a mistake or learn something new about this codebase, update this file to prevent the same mistake from happening again. Add lessons learned to the relevant section, or create a new "Lessons Learned" section at the bottom if needed.

## Development Mode

This project is in active development. Do not worry about database migrations — the schema can be changed directly and the database reset as needed. Prioritize speed and correctness over backwards compatibility.

## Commands

```bash
# Development
turbo dev              # Run CLI agent (from root)
bun run cli            # Alternative: run CLI directly
bun run web            # Run web app

# Quality checks (run after making changes)
 bun run ci                               # Run format check, lint, and typecheck
turbo typecheck                            # Type check all packages
turbo lint                                 # Lint all packages with oxlint
turbo lint:fix                             # Lint and auto-fix all packages

# Filter by package (use --filter)
turbo typecheck --filter=web               # Type check web app only
turbo typecheck --filter=@open-harness/cli # Type check CLI only
turbo lint:fix --filter=web                # Lint web app only
turbo lint:fix --filter=@open-harness/cli  # Lint CLI only

# Formatting (Biome - run from root)
bun run format                             # Format all files
bun run format:check                       # Check formatting without writing

# Testing
bun test                        # Run all tests
bun test path/to/file.test.ts   # Run single test file
bun test --watch                # Watch mode
```

## Git Commands

**Quote paths with special characters**: File paths containing brackets (like Next.js dynamic routes `[id]`, `[slug]`) are interpreted as glob patterns by zsh. Always quote these paths in git commands:

```bash
# Wrong - zsh interprets [id] as a glob pattern
git add apps/web/app/tasks/[id]/page.tsx
# Error: no matches found: apps/web/app/tasks/[id]/page.tsx

# Correct - quote the path
git add "apps/web/app/tasks/[id]/page.tsx"
```

## Architecture

This is a Turborepo monorepo for "Open Harness" - an AI coding agent built with AI SDK.

### Core Flow

```
CLI (apps/cli) -> TUI (packages/tui) -> Agent (packages/agent) -> Sandbox (packages/sandbox)
```

1. **CLI** parses args, creates sandbox, loads AGENTS.md files, and starts the TUI
2. **TUI** renders the terminal UI with OpenTUI, manages chat state via `ChatTransport`
3. **Agent** (`deepAgent`) is a `ToolLoopAgent` with tools for file ops, bash, and task delegation
4. **Sandbox** abstracts file system and shell operations (local fs or remote like Vercel)

### Key Packages

- **packages/agent/** - Core agent implementation with tools, subagents, and context management
- **packages/sandbox/** - Execution environment abstraction (local/remote)
- **packages/tui/** - Terminal UI with OpenTUI components
- **packages/shared/** - Shared utilities across packages

### Subagent Pattern

The `task` tool delegates to specialized subagents:
- **explorer**: Read-only, for codebase research (grep, glob, read, safe bash)
- **executor**: Full access, for implementation tasks (all tools)

## Code Style

### Package Manager
- Use **Bun exclusively** (not Node/npm/pnpm)
- The monorepo uses `bun@1.2.14` as the package manager

### TypeScript Configuration
- Strict mode enabled
- Target: ESNext with module "Preserve"
- `noUncheckedIndexedAccess: true` - always check indexed access
- `verbatimModuleSyntax: true` - use explicit type imports

### Formatting (Biome)
- Indent: 2 spaces
- Quote style: double quotes for JavaScript/TypeScript
- Organize imports: enabled via Biome assist
- Run `bun run format` before committing

### Naming Conventions
- **Files**: kebab-case (e.g., `deep-agent.ts`, `paste-blocks.ts`)
- **Types/Interfaces**: PascalCase (e.g., `TodoItem`, `AgentContext`)
- **Functions/Variables**: camelCase (e.g., `getSandbox`, `workingDirectory`)
- **Constants**: UPPER_SNAKE_CASE for true constants (e.g., `TIMEOUT_MS`, `SAFE_COMMAND_PREFIXES`)

### Imports
- **Do NOT use `.js` extensions** in imports (e.g., `import { foo } from "./utils"` not `"./utils.js"`)
  - The `.js` extension causes module resolution issues with Next.js/Turbopack
  - This applies to all packages and apps in the monorepo
- Prefer named exports over default exports
- Group imports: external packages first, then internal packages, then relative imports
- Use type imports when importing only types: `import type { Foo } from "./types"`

### Types
- **Never use `any`** - use `unknown` and narrow with type guards
- Define schemas with Zod, then derive types: `type Foo = z.infer<typeof fooSchema>`
- Prefer interfaces for object shapes, types for unions/intersections
- Export types alongside their related functions

### Error Handling
- Return structured error objects rather than throwing when possible:
  ```typescript
  return { success: false, error: `Failed to read file: ${message}` };
  ```
- When catching errors, extract message safely:
  ```typescript
  const message = error instanceof Error ? error.message : String(error);
  ```
- Use descriptive error messages that include context (tool name, file path, etc.)

### Testing
- Use Bun's test runner: `import { test, expect } from "bun:test"`
- Test files use `.test.ts` suffix
- Colocate tests with source files

### Bun APIs
- Prefer Bun APIs over Node when available:
  - `Bun.file()` for file operations
  - `Bun.serve()` for HTTP servers
  - `Bun.$` for shell commands in scripts

### AI SDK Patterns
- Tools are defined with Zod schemas for input validation
- Use `ToolLoopAgent` for agent implementations
- Tools receive context via `experimental_context` parameter
- Implement `needsApproval` as boolean or function for tool approval logic

## Tool Implementation Patterns

When creating tools in `packages/agent/tools/`:

```typescript
import { tool } from "ai";
import { z } from "zod";
import { getSandbox, getApprovalContext } from "./utils";

const inputSchema = z.object({
  param: z.string().describe("Description for the agent"),
});

export const myTool = (options?: { needsApproval?: boolean }) =>
  tool({
    needsApproval: (args, { experimental_context }) => {
      const ctx = getApprovalContext(experimental_context, "myTool");
      // Return true if approval needed, false otherwise
      return options?.needsApproval ?? true;
    },
    description: `Tool description with USAGE, WHEN TO USE, EXAMPLES sections`,
    inputSchema,
    execute: async (args, { experimental_context }) => {
      const sandbox = getSandbox(experimental_context, "myTool");
      // Implementation using sandbox methods
      return { success: true, result: "..." };
    },
  });
```

## Workspace Structure

```
apps/
  cli/           # CLI entry point (@open-harness/cli)
  web/           # Web interface
packages/
  agent/         # Core agent logic (@open-harness/agent)
  sandbox/       # Sandbox abstraction (@open-harness/sandbox)
  tui/           # Terminal UI (@open-harness/tui)
  shared/        # Shared utilities (@open-harness/shared)
  tsconfig/      # Shared TypeScript configs
```

## Common Patterns

### Workspace Dependencies
Use `workspace:*` for internal packages:
```json
{
  "dependencies": {
    "@open-harness/sandbox": "workspace:*"
  }
}
```

### Catalog Dependencies
Use `catalog:` for shared external versions:
```json
{
  "dependencies": {
    "ai": "catalog:",
    "zod": "catalog:"
  }
}
```

## Lessons Learned

- Skill discovery de-duplicates by first-seen name, so project skill directories must be scanned before user-level directories to allow project overrides.
- The system prompt should list all model-invocable skills (including non-user-invocable ones), and reserve user-invocable filtering for the slash-command UI.
- In Next.js App Router, dynamic route param names must match the folder segment exactly (e.g. `[sessionId]` requires `params.sessionId`, not `params.id`), or DB queries can receive `undefined` and fail at runtime.
- In shell tools, avoid piping primary command output directly to `head` when exit-code handling matters; pipeline semantics can mask real failures from the primary command.
- Glob patterns ending in `**` (for example `"**"` or `"src/**"`) should be treated as recursive, even when `**` is the final segment.
- Tool renderer `part.output` values may be `unknown`; when accessing fields like `files` or `matches`, add runtime narrowing/type guards first (in both TUI and web renderers) to satisfy strict typecheck.
- AI SDK stream handles may return `PromiseLike` values (not full `Promise`), so avoid methods like `.finally()` and use `then`/`catch` patterns that work with `PromiseLike`.
- Some planning docs still reference legacy `apps/web/app/tasks/[id]/...` paths; current UI/API code is centered on `apps/web/app/sessions/[sessionId]/chats/[chatId]/...`, so verify file paths before implementing plan items.
- Creating a sandbox snapshot automatically shuts down that sandbox; lifecycle plans and implementations must treat snapshotting as a stop/hibernate transition, not a non-disruptive backup.
- Vercel sandbox creation has a hard timeout limit of `18_000_000ms`; if you add an internal timeout buffer before calling the SDK, clamp proactive timeout so `timeout + buffer` never exceeds that API limit.
- In serverless environments, lifecycle checks that only run inline during request handlers are not durable; long-gap sandbox lifecycle actions must be scheduled with a durable workflow run (`start(...)` + `sleep(...)`) so they execute without a connected client.
- For Workflow DevKit discovery in Next.js, ensure workflow files live in scanned directories (for this app, `app/`), otherwise manifests can show steps but `0 workflows` and `start()` will not run durable workflows.
- Vercel `snapshot()` may return `422 sandbox_snapshotting` when another snapshot is already in progress; lifecycle code should treat this as an idempotent/in-progress condition and reconcile state instead of marking lifecycle as failed.
- The reconnect API can return `expired` when a sandbox has already stopped; client reconnection state should treat `expired` like `no_sandbox` so restore UX does not get stuck in a generic failure path.
- For workflow-managed sandbox lifecycle, avoid client-side timeout auto-stop logic in the chat UI; it can race with workflow hibernate and produce confusing paused overlays while the tab remains open.
- Status chips that derive from time-based sandbox validity should not rely on memoization without a time dependency; otherwise header state can drift from overlay/input state as `Date.now()` changes.
- Keep sandbox status UI elements (chip, overlay, and indicator dot) on a shared `isSandboxActive` source; mixed heuristics (e.g., one using grace-window validity and another using raw countdown) can show contradictory states like `Paused` with a green dot.
- Treat `/api/sandbox/reconnect` as a read-only status probe; reconnect polling should never refresh lifecycle activity timestamps or kick lifecycle workflows, or idle sessions can fail to hibernate correctly.
- For paused sessions, auto-resume on entry should trigger only after reconnect confirms `no_sandbox`; do not auto-restore on generic reconnect failures.
- Do not use `snapshotUrl` alone to infer paused/hibernating UI state; active sessions may retain a snapshot reference. Require absence of runtime sandbox state (`sandboxId`/`files`) before labeling hibernation.
- Keep sandbox mode details out of page/presentation components: expose capability flags (for example `supportsDiff`, `supportsRepoCreation`, `hasRuntimeSandboxState`) from shared context and branch UI on capabilities, not raw `sandboxState.type`.
- Auto-resume-on-entry for paused sessions must not require a prior `no_sandbox` reconnect result when there is no runtime sandbox state in DB; snapshot-only sessions can otherwise get stuck in `idle` and never restore.
- For predictive lifecycle UI countdowns, use server-provided timestamps (`hibernateAfter`, `sandboxExpiresAt`) plus a server-time offset from reconnect responses; do not rely on client clock alone for transition timing.
- Auto-resume for paused sessions must run only on initial session entry; once a tab has had an active sandbox, do not auto-resume after a later inactivity hibernate in that same tab.
- Keep the sandbox indicator dot on the same derived lifecycle state machine as the status chip; during inactivity countdown it should show a pausing state, and during server `hibernating` it should not remain green.
- Split lifecycle UI polling from connectivity probing: poll a lightweight DB-backed sandbox status endpoint for timing/state, and reserve reconnect/connect checks for entry/resume or explicit recovery paths.
- Prefer event-first lifecycle sync in the chat UI (chat completion, visibility return, window focus, network online), with sparse status polling (about 60s baseline, tighter only near transitions) instead of frequent fixed-interval polling.
- Snapshot restore should be idempotent when a sandbox is already running: return success with an `alreadyRunning` signal instead of a 400, and let the client reconnect/sync rather than surfacing a hard error.
- When syncing status timestamps, avoid rewriting local sandbox connection state on every response; only update if expiry materially changes, or UI effects can enter rapid request loops.
- Resume/paused UI must not rely only on `session.snapshotUrl` from initial page props; keep a live `hasSnapshot` signal from reconnect/status responses, or the UI can incorrectly show `No sandbox` and hide resume actions.
- `/api/sandbox/reconnect` should treat DB runtime state (`sandboxId`/`files`) as the source of reconnect eligibility; using `isSandboxActive` (which includes expiry heuristics) can misclassify recoverable sessions as `no_sandbox` and break restore/reconnect flows.
- When `/api/sandbox/reconnect` reports `connected`, it must persist refreshed sandbox runtime state/expiry (`sandboxState`, `sandboxExpiresAt`) back to DB; otherwise `/files` and `/diff` can still fail with `Sandbox not initialized` against stale expired state while UI thinks reconnect succeeded.
- For sandbox lifecycle UI, keep the client simple and server-authoritative: poll `/api/sandbox/status` on a fixed cadence (currently 15s) instead of combining multiple client-side event/predictive sync paths, which can drift or loop under reconnect/hibernation edge cases.
- Reconnect liveness probes can time out right after snapshot restore while the sandbox is still starting; treat probe timeouts as transient (non-terminal) and clear runtime state only for hard unavailability signals (stopped/not found/stream unavailable).
- Keep `/api/sandbox/status` as a DB-backed read-only view; do not mutate/clear sandbox runtime state from status polling, or active sessions can be downgraded to `no_sandbox` and later restore from stale snapshots.
- On Vercel reconnect (`state.sandboxId`), do not pass `remainingTimeout=0` from stale `state.expiresAt`; that creates an immediately-expired local wrapper and can make the header/API checks flip to `No sandbox` even while the VM is reachable.
- Reconnect success should refresh full active lifecycle timestamps (`lastActivityAt`, `hibernateAfter`, `sandboxExpiresAt`) before responding; otherwise UI status chips can stay stuck in `Pausing` from stale lifecycle fields.
- Lifecycle countdown UI windows should scale with configured inactivity timeout; fixed windows (for example 2 minutes) can make short test timeouts (for example 1 minute) appear to be perpetually pausing.
- Reconnect can return a sandbox handle whose command stream is unusable (`Expected a stream of command data`); reconnect should probe command execution before declaring `connected`, and file/diff routes should treat that error as sandbox-unavailable (hibernated) rather than a git-repo error.
- Client UI `sandboxUiStatus` must check server `lifecycleTiming.state` (from status poll) as primary source, not only local `sandboxInfo`; otherwise UI stays "Active" after server-side hibernation until the local timeout expires or user refreshes.
- The `isSandboxActive` client flag must incorporate `lifecycleTiming.state`; local `isSandboxValid(sandboxInfo)` alone is insufficient because the server can hibernate the sandbox while the local timeout is still valid.
- When the lifecycle workflow inline fallback runs (SDK unavailable), it evaluates immediately and skips because the sandbox isn't due yet; the status endpoint should detect overdue `hibernateAfter` and kick the lifecycle as a safety net.
- Lifecycle workflow must retry after a `skipped/not-due-yet` evaluation; without retry the sandbox never hibernates unless a new event kicks a fresh workflow.
- Next.js `after()` defers callbacks until the response is fully sent; for streaming endpoints this means `after()` runs after the entire stream completes, not at call time. Use fire-and-forget (`void run()`) for lifecycle kicks that must happen at request start.
- GitHub App install flow uses a three-path strategy: (1) no linked account → OAuth authorize URL with explicit `redirect_uri`, callback chains to install with `target_id`; (2) linked account but no installations → `installations/new/permissions?target_id={githubId}` directly; (3) linked account with installations → `select_target` for the account/org picker. Disable "Request user authorization (OAuth) during installation" on the GitHub App — it causes auto-redirect loops for already-authorized users on both `select_target` and `installations/new/permissions`.
- In Next.js Route Handlers, `cookies()` from `next/headers` combined with `Response.redirect()` silently drops Set-Cookie headers from the redirect response. Use `NextResponse.redirect()` with `response.cookies.set()` instead to ensure cookies are included in redirect responses.
- GitHub App must be made **public** for the org picker to appear during installation. While the app is private, `/installations/select_target` only shows the owner's personal account -- users cannot install on organizations. Use "Make public" in the GitHub App's Danger Zone when ready.
- Use `/installations/select_target` instead of `/installations/new` for the GitHub App install URL; the latter silently redirects to an existing personal installation's settings page instead of showing the account/org picker.
- GitHub App callbacks that process OAuth `code` or `installation_id` must validate a server-stored `state` nonce before linking accounts or syncing installations; never trust callback query params without CSRF/state verification.
- Installation sync that prunes DB records must fetch all GitHub API pages first (`per_page=100` + pagination); pruning from a partial page can silently remove valid installations.
- For lifecycle workflow kicks in request handlers, call `kickSandboxLifecycleWorkflow(...)` directly instead of wrapping it in `after(...)`; delayed/deferred scheduling can miss the initial hibernation timer for idle sessions.
- Hybrid sandbox wrappers must delegate `snapshot()` to the underlying cloud sandbox after handoff; if `snapshot` is missing on hybrid, lifecycle hibernation skips snapshotting and expired sessions fall back to creating a new sandbox.
- In the web chat UI, do not keep `@ai-sdk/react` Chat instances alive after route transitions while they are still streaming; abort local stream processing and remove the instance on teardown, then rely on resumable stream reconnect when revisiting that chat.
- For client-side tool flows (`ask_user_question`), `onFinish`-only assistant persistence is insufficient across route switches: persist the latest incoming message snapshot at API request start (upsert by message id) so answered/declined tool state survives teardown/resume and does not rehydrate stale `input-available` UI.
- Request-start assistant snapshot persistence must be scoped and ownership-guarded: only upsert assistant messages when the request still owns the chat stream token, and refuse upserts on message-id scope conflict (different chat/role) to prevent stale writes and cross-chat overwrites.
- Keep `activeStreamId` resumable at all times: do not publish pre-registration ownership placeholders to `activeStreamId` (resume probes can clear them as stale), and gate `onFinish` writes on the atomic compare-and-set result that clears the currently owned token.
- Usage analytics `messageCount` must represent assistant turns, not raw `usage_events` rows; when subagent/model breakdown rows are recorded, count only canonical main-agent rows in additive rollups to avoid inflated totals and heatmaps.
- After schema edits, review generated Drizzle migrations for unrelated schema drift changes before committing (for example defaults on untouched columns), since `drizzle-kit generate` can include those alongside intended changes.
- Unread correctness depends on visibility-aware read receipts and insert-only assistant activity updates: block read receipts for hidden tabs, but allow forced read marks on visible tabs without waiting for focus; only advance `lastAssistantMessageAt` when an assistant message upsert actually inserts a new row (not snapshot/tool-result updates).
- Chat list streaming indicators should poll more frequently while any chat is actively streaming (for example ~1s) and fall back to a slower cadence when idle, to avoid delayed white-to-complete indicator transitions after chat switches.
- Optimistic chat-title previews for `"New chat"` must have an explicit rollback on send failures; otherwise the sidebar can keep a title that was never persisted if the first request errors.
- `hadInitialMessages` is an initial-load snapshot, not a live "first turn" signal; guard one-time optimistic UI (like first-message title previews) with a dedicated runtime ref/state that resets on send failure.
- In the GitHub App install flow, do a user-token installation sync before redirecting after OAuth-only callbacks or treating zero local installation rows as "not installed"; GitHub can skip callback emissions for pre-existing installs.
- For sandbox lifecycle kicks, do not persist `lifecycleRunId` before `start(...)`; start first and let the durable workflow claim/verify the lease so canceled fire-and-forget kicks cannot strand a stale lease.
