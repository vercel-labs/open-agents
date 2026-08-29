# Chat Harness Selector Handoff

> Superseded on June 14, 2026. The runtime now uses `@ai-sdk/harness`,
> `@ai-sdk/harness-codex`, `@ai-sdk/harness-claude-code`, and
> `@ai-sdk/sandbox-vercel`. The implementation lives in
> `packages/harness-runner` and `VercelSandbox.toHarnessSandboxProvider()`.

Status: foundational selector, sandbox attachment, and base-snapshot preparation
hook work complete. Runtime dispatch is intentionally incomplete. Do not enable
Codex or Claude Code yet.

## Goal

Allow each Open Agents chat to select an agent harness independently, similar
to model selection:

- `open-agent`
- `codex`
- `claude-code`

A branch/session can contain multiple chats with different harnesses. A chat
may select its harness before its first message is sent. Once the chat has any
persisted message, its harness is immutable. Forked chats inherit their source
chat's harness because they already contain copied messages.

Harness selection must remain orthogonal to model selection. A harness is a
runtime/tool-loop choice, not a model ID.

## Architecture Decision

Open Agents remains the durable workflow and sandbox lifecycle owner:

```text
Open Agents web app
  -> durable chat workflow
    -> chat-scoped selected harness
      -> caller-owned Open Agents sandbox
```

The existing `open-agent` runtime runs through the current external
`ToolLoopAgent` loop. The existing `agent-harness-sdk` Codex and Claude Code
adapters run native bridge processes inside the sandbox while the durable
workflow remains outside.

Do not create a second sandbox for Codex or Claude Code. Use the harness SDK's
caller-owned provided sandbox mode:

```ts
provideSandbox({
  backend,
  session,
  bridgePorts: [5001],
});
```

## Completed Foundation

- Added `apps/web/lib/chat-harnesses.ts`.
  - Defines `ChatHarnessId`, `DEFAULT_CHAT_HARNESS_ID`, display options, and
    validation helpers.
  - Only `open-agent` is marked executable for now.
  - `codex` and `claude-code` are represented but unavailable until runtime
    dispatch is implemented.
- Added `chats.harnessId` to `apps/web/lib/db/schema.ts`.
- Threaded the default `open-agent` harness into:
  - normal session creation
  - repo page session creation
  - additional chat creation
- Threaded inherited `harnessId` into chat forks.
- Added `updateChatHarnessIfEmpty()` in `apps/web/lib/db/sessions.ts`.
  - This performs the immutability check atomically in SQL by updating only
    when no `chat_messages` row exists for the chat.
- Extended the chat refresh/PATCH API:
  - GET returns `harnessId`.
  - PATCH validates harness IDs.
  - PATCH rejects unavailable harnesses.
  - PATCH rejects changes after the first persisted message with HTTP `409`.
- Added a `/api/chat` guard so a chat cannot execute a harness that is not
  wired yet.
- Threaded the selected `harnessId` into the durable workflow start payload.
  The workflow rejects unimplemented harnesses before sandbox or model side
  effects, leaving a stable dispatch point for `runHarnessAgentSlice()`.
- Generated additive migration `0037_classy_vengeance.sql`.
- Added the compact chat-scoped harness selector beside the model selector.
  Unavailable harnesses are visible but disabled. The selector locks once a
  chat has messages, while streaming, and while an update is pending.
- Added optimistic harness metadata for new and forked chats.
- Added API and hook tests for defaulting, validation, unavailable harnesses,
  atomic empty-chat updates, post-message locking, and fork inheritance.
- Reserved Vercel Sandbox port `5001` for the external harness bridge and
  excluded it from user-selectable dev-server ports.
- Added `VercelSandbox.toAgentHarnessWorkspace()` in
  `packages/sandbox/vercel/sandbox.ts`.
  - Adapts the existing caller-owned Open Agents sandbox to the structural
    hosted-workspace surface expected by `agent-harness-sdk`.
  - Delegates command execution, detached bridge processes, file access,
    bridge port URLs, and network policy updates.
  - Keeps sandbox lifecycle ownership in Open Agents.

Open Agents verification passed:

```bash
pnpm run ci
pnpm --dir apps/web db:check
```

## Runtime Integration Blockers

The selector metadata can land before Codex and Claude Code execution, but
those runtimes should not be marked available until these blockers are
resolved.

### 1. AI SDK Version Boundary

Open Agents currently uses AI SDK `^6.0.165`.

`agent-harness-sdk` currently peers against `ai@7.0.0-canary.126`.

Do not directly import harness stream result types into the Open Agents UI
until this version boundary is intentionally resolved. Options:

- move both repos to one compatible AI SDK version
- expose a version-neutral harness event protocol and normalize it inside
  Open Agents

### 2. Sandbox Attachment And Setup

Open Agents owns a durable named Vercel Sandbox and reconnects it at workflow
step boundaries. Prefer adapting the already-connected Open Agents wrapper:

```ts
const session = sandbox.toAgentHarnessWorkspace();
const provided = provideSandbox({
  backend,
  session,
  bridgePorts: [5001],
});
```

`agent-harness-sdk` also accepts a Vercel Sandbox name resolver when direct
attachment is useful, but the wrapper adapter avoids reconnecting twice.

Prepare the Open Agents sandbox template before attaching harness runs. The
SDK provides a combined profile helper:

```ts
await prepareAdapterSandboxRuntimeProfile({
  session: sandbox.toAgentHarnessWorkspace(),
  adapters: ["codex", "claude-code"],
});
```

The helper installs one union dependency manifest, adapter post-install steps,
base tooling, and the proxy binary. It deliberately excludes bridge files:
provided-mode runs keep the default `runtimeSetup: "refresh"` behavior and
write the selected adapter's current bridge files when attaching.

`ensureVercelSnapshotTemplate()` and `refreshBaseSnapshot()` accept a `prepare`
callback that runs before snapshotting, so the SDK helper has stable automatic
and manual Open Agents provisioning hooks.

The SDK helper is merged on `agent-harness-sdk` main at:

```text
174f4aac23661a90830775a333bcdb88f1d6ad99
```

The helper is published in
`@agent-harness-experimental/sandbox-images@0.0.5`. The Open Agents web build
now prewarms a deployment-scoped named Vercel Sandbox template with the
combined Codex + Claude Code profile. Fresh user sandboxes resolve the
template's current snapshot internally, so deployments do not need an
operator-managed snapshot ID. The manual snapshot refresh command remains
available for explicitly layering a new snapshot from an existing one.

Open Agents must remain the sandbox lifecycle owner. Harness cleanup should
close bridge/proxy handles without deleting the underlying sandbox.

### 3. Sandbox Ports

Open Agents now exposes:

```ts
[3000, 5173, 4321, 8000, 5001]
```

`5001` is reserved for one harness bridge slot. Reserve `5000` as well if the
harness HTTP egress proxy is enabled. Vercel Sandbox is limited to five exposed
ports, so that requires intentionally dropping a preview port.

### 4. Durable Workflow Runner

Do not nest the harness SDK's experimental workflow helper inside the Open
Agents workflow. Open Agents already owns streaming, cancellation, persistence,
sandbox hibernation, and GitHub post-finish automation.

Add a branch in the durable chat workflow:

```text
open-agent   -> current runAgentStep loop
codex        -> runHarnessAgentSlice
claude-code  -> runHarnessAgentSlice
```

For Codex and Claude Code:

1. reconnect the caller-owned sandbox
2. create or resume the harness session
3. stream normalized UI events
4. export complete harness resume state
5. detach bridge handles at workflow slice boundaries
6. resume later when required

Persist the full harness resume state, including cursor, pending interaction,
adapter state, and network state.

### 5. UI Event and Continuation Mapping

Codex and Claude Code expose different built-in tools from the current Open
Agent tool set. Normalize their events at the runner boundary. Map approvals
and ask-user continuations into the current Open Agents interaction UI.

Do not pass duplicate filesystem and shell host tools into Codex or Claude Code
unless there is a specific reason. They already provide native built-ins.

## Suggested Implementation Order

1. Completed: persist chat metadata and ship selector UI with only
   `open-agent` executable.
2. Completed: add configurable Vercel Sandbox name attachment and explicit
   caller-owned dependency setup in `agent-harness-sdk`.
3. Completed: adapt the connected Open Agents wrapper, reserve sandbox bridge
   port `5001`, and add the Open Agents base-snapshot preparation hook.
4. Completed: publish the merged SDK helper packages and wire the combined
   Codex + Claude Code profile into build-prewarmed deployment templates.
5. Resolve the AI SDK version/event protocol boundary.
6. Add `runHarnessAgentSlice()` with Codex first.
7. Verify detach, resume, cancellation, and post-finish Git behavior.
8. Enable `codex` in `CHAT_HARNESS_OPTIONS`.
9. Repeat for Claude Code and enable `claude-code`.

## Validation

After completing the Open Agents changes:

```bash
pnpm run ci
pnpm --dir apps/web db:check
```

After replay-E2E or bridge changes in `agent-harness-sdk`, follow that repo's
`AGENTS.md`:

```bash
pnpm validate
pnpm test:e2e
```

Use targeted bridge and replay tests first while debugging.
