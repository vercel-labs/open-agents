# Why not DurableAgent?

This document explains why migrating Open Harness from the current `ToolLoopAgent`-based architecture to Workflow's `DurableAgent` is difficult right now.

This is not a statement that `DurableAgent` is bad, or that we should never use it. It is a statement that an **exact migration** of the current agent is not a drop-in package swap. The hard part is not the model loop itself. The hard part is that large parts of Open Harness are built around `ToolLoopAgent`-specific behavior.

## Short version

A new durable package is feasible, but it would not be a drop-in replacement for `packages/agent`.

The biggest issues are:

1. the current agent depends on per-call configuration through `callOptionsSchema` and `prepareCall`
2. the web app and CLI both depend on `ToolLoopAgent`'s current stream/result shape
3. several existing tools rely on features that do not map directly to `DurableAgent`
4. the current runtime passes live objects like `Sandbox`, while Workflow expects serializable workflow inputs
5. the CLI is not currently built around Workflow execution at all

## Where the current architecture is tightly coupled

The current agent is centered on `packages/agent/open-harness-agent.ts`.

That file defines a singleton `openHarnessAgent` and relies on:

- `callOptionsSchema`
- `prepareCall`
- `prepareStep`
- `experimental_context`
- `ToolLoopAgent` streaming helpers and result helpers

That API surface is then consumed directly by:

- `apps/web/app/api/chat/route.ts`
- `apps/web/app/config.ts`
- `apps/web/app/types.ts`
- `apps/cli/tui/config.ts`
- `apps/cli/tui/transport.ts`
- `apps/cli/tui/types.ts`
- `packages/agent/subagents/explorer.ts`
- `packages/agent/subagents/executor.ts`

So this is not just a package-internal refactor. It changes the contract that multiple apps depend on.

## Why the migration is hard

### 1. The current agent is configured at call time

Today, the main agent is created once and then configured per request using call options.

That is how Open Harness injects:

- `sandbox`
- `approval`
- `model`
- `subagentModel`
- `customInstructions`
- `skills`
- compaction context

This happens in `packages/agent/open-harness-agent.ts` through `callOptionsSchema` and `prepareCall`.

`DurableAgent` does not expose that same pattern. Its configuration is split between:

- constructor-time options
- per-`stream()` options
- workflow-level setup

So the current API shape cannot be preserved exactly. We would need a new factory or wrapper API that closes over Open Harness configuration and returns a configured durable runtime.

### 2. The current stream/result contract is different

The web app and CLI rely on `ToolLoopAgent` result helpers.

Examples:

- `apps/web/app/api/chat/route.ts` uses `result.toUIMessageStreamResponse(...)`
- `apps/cli/tui/transport.ts` uses `result.toUIMessageStream(...)`
- the web route also relies on `result.consumeStream()` and `result.usage`
- the current subagent flow depends on `fullStream`, `response`, and step-level events

`DurableAgent` does not return that same object shape. It writes to a workflow stream using `getWritable()` and returns a different result object.

That means the migration is not just "swap the class and keep the callers the same". Both web and CLI integration code would need new adapters.

### 3. Type inference currently depends on the agent instance

The current apps derive important types from the singleton agent itself.

Examples:

- `apps/web/app/types.ts`
- `apps/cli/tui/types.ts`

Those files derive call options and tool/message types from the current agent API.

That becomes a problem with `DurableAgent` because:

- it does not expose the same call signature
- the current code expects access to agent-level tools for typing and message conversion
- `DurableAgent.generate()` is not the equivalent surface the current code expects to derive from

So a durable package would need to export explicit types and probably explicit toolsets, instead of relying on inference from a singleton `ToolLoopAgent` instance.

### 4. Some tools rely on `ToolLoopAgent`-specific behavior

Several tools are simple and portable. Others are not.

#### `ask_user_question`

`packages/agent/tools/ask-user-question.ts` is currently a client-side tool with:

- an `outputSchema`
- `toModelOutput`
- no normal `execute`

That works with the current agent/UI contract, but it does not map directly to a normal durable executable tool.

A durable version would likely need to be rebuilt around Workflow hooks or webhooks instead of the current client-side tool pattern.

#### `task`

`packages/agent/tools/task.ts` is even more coupled.

It currently relies on:

- an `async function*` execute path
- progressive output updates
- `outputSchema`
- `toModelOutput`
- nested `ToolLoopAgent` subagents from `packages/agent/subagents/`

That is not impossible to rebuild, but it is not a direct port.

#### approval-aware tools

Many tools use `needsApproval` and read approval state from `experimental_context`.

Examples include:

- `packages/agent/tools/bash.ts`
- `packages/agent/tools/read.ts`
- `packages/agent/tools/write.ts`
- `packages/agent/tools/task.ts`
- `packages/agent/tools/skill.ts`

That approval model is part of the current agent contract. `DurableAgent` does not automatically reproduce it, so approval behavior would need a new durable-specific design.

### 5. The current runtime passes live objects that are not workflow-friendly

The current agent passes a live `Sandbox` object through call options and then through `experimental_context`.

That works in the current in-process architecture, but durable workflows prefer serializable inputs and durable reconstruction.

This matters because Open Harness tools expect live access to:

- file reads and writes
- command execution
- detached processes
- current working directory and branch
- environment details

A durable implementation can still support this, but it likely needs a new config layer based on serializable sandbox state and workflow-time reconstruction, not the current "pass a live sandbox around" model.

### 6. The current model layer is not shaped for `DurableAgent`

Open Harness currently uses `packages/agent/models.ts`, which returns AI SDK `LanguageModel` objects directly.

`DurableAgent` expects either:

- a model string, or
- a workflow-safe function that resolves a compatible model

So even model setup is not a direct reuse. We would need durable-aware wrappers around the current gateway/provider setup.

### 7. Context management and cache control need a real port

The current agent does important work in `prepareStep`:

- compaction via `packages/agent/context-management/aggressive-compaction.ts`
- cache-control injection via `packages/agent/context-management/cache-control.ts`

That logic is portable in principle, but it still has to be adapted to the durable execution model and message lifecycle.

This is not a blocker, but it is real migration work.

### 8. The web app is a better target than the CLI

The web app already uses Workflow elsewhere:

- `apps/web/next.config.ts` uses `withWorkflow`
- `apps/web/app/workflows/sandbox-lifecycle.ts` already defines workflow functions
- `apps/web/lib/sandbox/lifecycle-kick.ts` already starts workflows

So the web side has infrastructure we can build on.

The CLI does not.

The CLI currently imports `@open-harness/agent` directly and runs the agent locally through the TUI transport layer. It is not built around workflow runs, resumable streams, or workflow-backed tool execution.

That means a durable migration is much more natural for the web app than for the CLI. Trying to make both migrate together would increase the complexity substantially.

### 9. `@workflow/ai` is still experimental and version-sensitive

The Workflow docs explicitly call `@workflow/ai` experimental.

There is also version coupling to think about:

- `apps/web/package.json` currently depends on `workflow`
- a durable package would also need `@workflow/ai`
- those versions need to stay aligned

That does not make the work impossible, but it does increase maintenance risk, especially if we try to make the durable package the single agent implementation for every runtime.

## Why this is hard even if we only care about matching behavior

The request is not just to make something durable. The request is to copy the existing agent's functionality exactly, but with `DurableAgent`.

That is what makes this difficult.

If we only wanted a simpler durable coding agent for the web app, that is much easier.

If we want to preserve all of the following at the same time, the work becomes much larger:

- the current tool list
- the current approval model
- the current ask-user-question behavior
- the current subagent/task behavior
- the current web streaming behavior
- the current CLI behavior
- the current type inference strategy
- the current sandbox integration model

That is not a class swap. It is an architecture change.

## What still looks feasible

A **new sibling package** is feasible.

The most realistic path is:

1. keep `packages/agent` as the `ToolLoopAgent` implementation for the CLI and current local flows
2. create `packages/durable-agent` as a workflow-backed implementation for the web app
3. share reusable logic where possible:
   - system prompt building
   - skill discovery/loading
   - usage aggregation
   - context management helpers
   - simple tool execution logic
4. rebuild the non-portable parts behind durable-specific APIs

This would let us adopt Workflow durability where it fits best without forcing a full replacement of the current agent architecture in one step.

## Recommended conclusion

We should not think about this as:

- "replace `ToolLoopAgent` with `DurableAgent`"

We should think about it as:

- "design a new durable execution path for Open Harness, then decide how much of the current agent contract should be preserved"

That makes the work much more tractable.

If we choose to proceed, the safest plan is:

- target the web app first
- treat the durable implementation as a sibling package, not a replacement package
- explicitly redesign approval, ask-user-question, and task/subagent behavior instead of trying to force an exact 1:1 port

## Related docs

- `docs/plans/incomplete/durable-agent-implementation.md`
- `packages/agent/open-harness-agent.ts`
- `packages/agent/tools/task.ts`
- `packages/agent/tools/ask-user-question.ts`
- `apps/web/app/api/chat/route.ts`
- `apps/cli/tui/transport.ts`
