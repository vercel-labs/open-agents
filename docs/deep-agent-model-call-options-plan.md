# Deep Agent Model Call Options Plan

## Problem Statement

The deep agent currently hardcodes its model selection and exports a `deepAgentModelId`
string for UI display. This couples application concerns (model choice and UI display)
to the agent package. We want model ownership to live in the application layer (similar
to sandbox ownership), while still allowing per-call model overrides through agent
call options.

## Goals

- Let applications own the chosen model and pass it into the agent call options.
- Support `model?: LanguageModel` in deep agent call options, aligned with AI SDK types
  (string model ID or `LanguageModelV3`).
- Apply provider-specific cache-control to tools and messages based on the selected
  model for each call.
- Keep subagent models fixed in the agent package (no model override for subagents).
- Remove the need for `deepAgentModelId` export from the agent package.

## Non-goals

- Adding model selection UI or automatic model routing logic.
- Changing subagent models or exposing subagent model selection as a call option.
- Introducing new model normalization utilities (no gateway resolver changes).

## Proposed Approach

1. **Deep agent call options include `model?: LanguageModel`.**
   The model is optional; if not provided, use the agent's default model.

2. **Use the per-call model in `prepareCall`.**
   `prepareCall` has access to both `options` and `settings`, so we can pick the
   effective model as `options.model ?? settings.model` and return it.

3. **Apply cache-control per call for tools and messages.**
   Use `addCacheControl({ tools, model })` in `prepareCall` so tools are configured
   according to the selected model, not just the agent default. For messages, use the
   model provided to `prepareStep` (already available on the first argument).

4. **App owns model selection and UI display.**
   Applications pass a model string (or `LanguageModel` object) into agent options and
   use that same value for UI display and context-limit calculations.

## Detailed Plan

### 1. Deep agent call options and prepareCall

- File: `packages/agent/deep-agent.ts`
  - Extend `callOptionsSchema` with:
    ```ts
    model: z.custom<LanguageModel>().optional(),
    ```
  - In `prepareCall`, compute:
    ```ts
    const callModel = options.model ?? model;
    ```
  - Return `model: callModel` and `tools: addCacheControl({ tools, model: callModel })`
    so the per-call model drives tool cache-control.
  - Keep `prepareStep` using the `model` passed in the first argument for message
    cache-control (this already supports per-call model selection).

### 2. Remove agent export of model ID

- File: `packages/agent/index.ts`
  - Stop exporting `deepAgentModelId`.
  - Update any internal references to rely on app-level config instead.

### 3. TUI: model ownership and display

- Files: `packages/tui/config.ts`, `packages/tui/index.tsx`,
  `packages/tui/chat-context.tsx`, `packages/tui/types.ts`
  - Update the TUI config to hold an application-owned model identifier
    (string or `LanguageModel`), and pass that value to:
    - Header display (model label).
    - Context-limit calculation via `getContextLimit`.
  - Ensure `agentOptions` include `model` when creating default options.

### 4. CLI: pass model from application config

- File: `apps/cli/index.ts`
  - Use the app-owned model configuration to populate both:
    - `agentOptions.model`
    - header `model` display
  - This keeps the CLI model choice local to the CLI app.

### 5. Web app: optional UI model display

- Files: `apps/web/app/config.ts` and the relevant chat provider(s)
  - If the web UI shows a model label or uses `getContextLimit`, pass the model from
    a local config (similar to the CLI approach).
  - If there is no model display, only pass `agentOptions.model` for agent calls.

### 6. Subagents remain fixed

- Files: `packages/agent/subagents/explorer.ts`,
  `packages/agent/subagents/executor.ts`, `packages/agent/tools/task.ts`
  - No changes to subagent call options.
  - Document that subagents are pinned to their current model (haiku).

## Compatibility Notes

- `model` is optional in call options, so existing calls remain valid.
- Removing `deepAgentModelId` is a breaking change for any consumers that import it;
  update those consumers to use their own model config.
- When passing `LanguageModel` objects (not strings), UI display should use a string
  label owned by the app (e.g., store a `modelLabel` alongside the model).

## Validation

- Typecheck to ensure `DeepAgentCallOptions` includes `model?: LanguageModel`.
- Run `turbo typecheck --filter=@open-harness/agent` and `--filter=@open-harness/tui`.
- Manually confirm header model display and context limit are sourced from app config.
