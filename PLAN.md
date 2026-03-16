Summary: Simplify model ID handling by separating two concerns cleanly: the web route should only resolve variant IDs into agent model selections, and the agent should only normalize those selections into actual model instances. Remove the current `gateway()` calls that look like validation but do not actually validate model IDs.

Context: `apps/web/app/api/chat/route.ts` currently duplicates nearly identical main/subagent resolution logic and calls `gateway(...)` inside `try/catch` blocks to “validate” model IDs before passing them to `webAgent.stream`. Upstream `@ai-sdk/gateway` does not validate IDs when you construct a model object; it just wraps the ID, so those fallback branches are misleading and effectively dead. In `packages/agent/open-harness-agent.ts`, `resolveAgentModelSelection(...)` is also more of a normalization helper than true resolution, which adds to the confusion.

Approach: Keep the route responsible for web-specific variant handling and warning on missing variants, but make it return a single `AgentModelSelection` object that can be passed straight into `webAgent.stream`. In the agent package, keep model handling as a pure normalization step (string -> `{ id }`) before instantiating the language model, and rename that helper to reflect what it actually does.

Changes:
- `apps/web/app/api/chat/route.ts` - extract a small helper that resolves a raw chat/subagent model ID plus variant list into an `AgentModelSelection`; remove fake `gateway()` validation; reuse the same helper for both main and subagent models; pass the resolved selection object directly into `webAgent.stream`; use `selection.id` for usage tracking.
- `packages/agent/open-harness-agent.ts` - rename/simplify the current model-selection helper so it clearly represents normalization instead of resolution; keep behavior the same.
- `apps/web/app/api/chat/route.test.ts` - capture the stream options passed to `webAgent.stream` and add assertions for: direct model IDs, variant IDs carrying provider overrides, and missing variant fallback to the default model.

Verification:
- Install dependencies with `bun install` if `node_modules` is missing.
- Run `bun test apps/web/app/api/chat/route.test.ts`.
- Run `bun run typecheck`.
- Run `bun run ci`.
- Edge cases to confirm: direct model IDs pass through unchanged; variant IDs map to base model IDs with provider overrides; missing variant IDs warn and fall back to `DEFAULT_MODEL_ID` without pretending to validate arbitrary IDs locally.
