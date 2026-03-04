# Session Chat Context Refactor Plan

## File in Scope

- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-context.tsx`

## Why Refactor

`session-chat-context.tsx` currently mixes several concerns in one provider (~1200 lines):

1. Chat stream runtime and recovery behavior
2. Sandbox lifecycle management and reconnection
3. Session/chat mutation actions
4. Workspace data loading (diff/git/files/skills/models)
5. Context value composition and memo dependency management

This makes the file hard to reason about, hard to test, and increases rerender surface area.

## Refactor Goals

- Reduce cognitive load by separating responsibilities
- Preserve existing behavior and API shape for consumers during migration
- Keep changes incremental and low-risk
- Prepare for optional context splitting to reduce rerenders

## Proposed Module Decomposition

## 1) Shared types and helpers

Create utility modules with pure logic:

- `session-chat.types.ts`
  - `SandboxInfo`
  - `ReconnectionStatus`
  - `LifecycleTimingInfo`
  - `SandboxStatusSyncResult`
  - `RetryChatStreamOptions`
  - `ModelsResponse`

- `session-chat.utils.ts`
  - `KNOWN_SANDBOX_TYPES`
  - `asKnownSandboxType`
  - `hasRuntimeSandboxData`
  - `toMs`
  - `toPositiveInteger`
  - `resolveContextLimitForModel`
  - `shouldAutoSubmit`

These are side-effect-free and can be moved first.

## 2) Focused hooks

Extract behavior into dedicated hooks:

- `hooks/use-session-chat-runtime.ts`
  - transport setup
  - chat instance creation/reuse
  - stop/retry/resume behavior
  - route cleanup / transport abort

- `hooks/use-sandbox-lifecycle.ts`
  - sandbox info state and cache
  - reconnection status
  - lifecycle timing state
  - `attemptReconnection` and `syncSandboxStatus`
  - shared sandbox-reset transition (preserve type, clear runtime fields)

- `hooks/use-session-workspace-data.ts`
  - diff/git/files/skills hooks
  - refresh wrappers
  - cache update side effects for fresh diff

- `hooks/use-session-actions.ts`
  - archive/unarchive
  - title update
  - chat model update
  - snapshot/repo/PR update helpers
  - sessions list cache mutate helpers

- `hooks/use-model-context-limit.ts`
  - models fetch (with fallback)
  - selected model context window resolution

## 3) Keep provider thin

After extraction, `session-chat-context.tsx` should primarily:

- initialize top-level `sessionRecord` and `chatInfo`
- call focused hooks
- derive a few booleans (`preferredSandboxType`, `supportsDiff`, etc.)
- compose and provide context value

Target: provider is orchestration only, with minimal business logic.

## Duplication to Eliminate

## Sandbox reset path duplication

The same state reset pattern appears in multiple places (`clearSandboxInfo`, reconnection/status fallback paths). Consolidate to one helper.

## Sessions list cache mutate patterns

`archive/unarchive/PR update` each repeat list cache update logic. Centralize into small helper functions in `use-session-actions.ts`.

## Migration Plan (Safe, Incremental)

### Phase 1: Pure extraction (no behavior change)

- Move types and pure helper functions into dedicated files
- Keep all stateful logic in provider for now

### Phase 2: Extract one hook at a time

Suggested order:

1. `use-model-context-limit` (smallest)
2. `use-session-workspace-data`
3. `use-session-actions`
4. `use-sandbox-lifecycle`
5. `use-session-chat-runtime` (highest sensitivity)

### Phase 3: Optional context split (performance)

If rerenders are still noisy, split provider into:

- `SessionChatStreamContext`
- `SessionWorkspaceContext`
- `SessionMetadataContext`

Keep a compatibility `useSessionChatContext()` wrapper to avoid immediate consumer churn.

## Validation Checklist

After each phase:

- Chat stream stop/retry/resume behavior unchanged
- Reconnection state transitions unchanged (`idle/checking/connected/failed/no_sandbox`)
- Archive/unarchive and title/model update flows still update session list cache correctly
- Diff/git/files/skills refresh behavior unchanged
- Existing UI behavior and route transition cleanup remain intact

## Non-Goals

- No API redesign for session/chat routes
- No behavioral changes to reconnection policy
- No new dependencies

## Suggested Final File Layout

- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-context.tsx`
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat.types.ts`
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat.utils.ts`
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/hooks/use-model-context-limit.ts`
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/hooks/use-session-chat-runtime.ts`
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/hooks/use-sandbox-lifecycle.ts`
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/hooks/use-session-workspace-data.ts`
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/hooks/use-session-actions.ts`
