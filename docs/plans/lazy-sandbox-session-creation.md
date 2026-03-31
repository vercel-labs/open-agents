# Lazy sandbox session creation

Summary: Allow sessions to be created without an active sandbox, and make sandbox provisioning a lazy first step of chat execution or explicit resume. This keeps session creation lightweight, removes the up-front wait before the first message, and makes programmatic session creation simpler.

## Context

- `apps/web/app/api/sessions/route.ts` already creates a session and initial chat without a live `sandboxId`; it stores desired sandbox configuration in `sandboxState: { type: "vercel" }`.
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx` currently auto-creates a sandbox on page entry and blocks sending until the sandbox is active.
- `apps/web/app/api/chat/route.ts` currently requires an active sandbox before a chat request can proceed.
- `apps/web/app/api/sandbox/route.ts` contains the create/reconnect logic that provisions a sandbox and persists the resulting runtime state.
- `apps/web/app/workflows/chat.ts` assumes the workflow is started with an already-usable sandbox.

## Approach

Treat session creation and sandbox creation as separate concerns:

1. Session creation creates durable app state only.
2. The first message (or an explicit resume action) ensures a sandbox exists.
3. Once a sandbox is ready, the normal agent workflow proceeds unchanged.
4. Eager sandbox creation can remain as an optimization, not a requirement.

This makes the default contract:

- `POST /api/sessions` returns `sessionId` and `chatId` even if no runtime sandbox exists yet.
- `POST /api/chat` does not require a caller-provided `sandboxId` for normal usage.
- Sandbox creation/reconnect/restore becomes an internal “ensure runtime” step.

## Recommended workflow

1. Create a session.
2. Navigate to the chat immediately.
3. Let the user send the first message without waiting for sandbox creation.
4. On first send:
   - reuse an already-active sandbox if one exists
   - otherwise reconnect to an existing runtime if possible
   - otherwise restore from snapshot if appropriate
   - otherwise create a new sandbox
5. Persist the resulting runtime state (`sandboxId`, expiry, branch, lifecycle data).
6. Start the agent turn.
7. Reuse that sandbox for later messages.

## API shape

### Session creation

```ts
POST /api/sessions
-> {
  session: { id: string, ... },
  chat: { id: string, ... },
  sandbox: { state: "pending" }
}
```

### Chat execution

```ts
POST /api/chat
{
  sessionId: string,
  chatId: string,
  messages: [...],
  sandboxId?: string
}
```

Notes:
- `sandboxId` stays optional for reconnect or advanced callers.
- Normal callers should not need to know whether a sandbox already exists.

## Changes

- `apps/web/app/api/sessions/route.ts`
  - Keep session creation lightweight.
  - Consider renaming lifecycle semantics so a newly created session is not described as actively provisioning when no sandbox boot has started yet.

- `apps/web/app/api/sandbox/route.ts`
  - Extract the create/reconnect logic into a shared `ensureSessionSandbox(...)` helper so manual sandbox actions and chat startup use the same code path.

- `apps/web/app/api/chat/route.ts`
  - Remove the hard precondition that the sandbox must already be active.
  - Ensure the session sandbox before creating the chat runtime.

- `apps/web/app/api/chat/_lib/runtime.ts`
  - Accept the ensured runtime state rather than assuming `sessionRecord.sandboxState` is already active.

- `apps/web/app/workflows/chat.ts`
  - Option A: keep sandbox ensuring in the API route before starting the workflow.
  - Option B: make sandbox ensuring the formal first workflow step.
  - Recommendation: start with Option A for the smallest change.

- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx`
  - Stop blocking the first send purely because no sandbox is active yet.
  - Replace that with a visible “Preparing sandbox…” state after send.
  - Keep explicit create/resume controls for manual recovery cases.

- `apps/web/lib/sandbox/utils.ts`
  - Clarify the distinction between “desired sandbox config exists” and “runtime sandbox is active”.

- `apps/web/lib/db/schema.ts`
  - Consider adding a clearer lifecycle state such as `pending` / `awaiting_start` if the current `provisioning` label becomes misleading.

## Tradeoffs

### Benefits

- Better UX: users can send immediately.
- Lower cost: abandoned sessions never allocate a sandbox.
- Cleaner API: sessions can be created programmatically without infra setup.
- Better separation of concerns: a session is durable state; a sandbox is attachable runtime.

### Risks

- The first-send path now needs a session-level lock to avoid double sandbox creation.
- Sandbox boot latency moves into the first message path, so the UI must explain what is happening.
- Sandbox failures become chat-start failures and need retryable UX.
- Existing lifecycle labels may no longer accurately describe state.

## Recommendation

Adopt lazy sandbox creation as the default contract.

Specifically:
- keep `POST /api/sessions` sandbox-agnostic
- make `sandboxId` optional in the mental model and API contract
- introduce a shared `ensureSessionSandbox(...)` helper
- call that helper from chat startup
- preserve eager prewarming only as an optional optimization

## Verification

- Create an empty session and immediately send a first message; sandbox should provision and the turn should run.
- Create a repo-backed session and immediately send a first message; clone/branch setup should happen exactly once.
- Send the first message from two tabs concurrently; only one sandbox should be created.
- Create a session programmatically through `POST /api/sessions`; later chat execution should still work.
- Manual sandbox create/resume flows should continue to work.
- Snapshot restore should still bypass stale pre-created runtime state.
