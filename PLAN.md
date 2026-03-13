Summary: Preserve the new string-based `createOpenHarnessAgent` API while restoring model-variant provider option behavior for both the main agent and subagents.

Context: `apps/web/app/api/chat/route.ts` still resolves model selections via `resolveModelSelection(...)`, which returns both `resolvedModelId` and optional `providerOptionsByProvider`. Before the API change, those overrides were applied at the call site by constructing `gateway(...)` models directly. After switching `createOpenHarnessAgent` to accept model IDs, those overrides are validated but discarded. The right place to preserve them is the agent factory boundary, not the route.

Approach: Extend `createOpenHarnessAgent` to accept model selection objects keyed by model ID plus optional provider overrides, and let the factory instantiate gateway models with those overrides internally. This keeps the external API string-first while preserving existing variant behavior and keeping route logic simple.

Changes:
- `packages/agent/open-harness-agent.ts` - expand config shape so `model` and `subagentModel` can carry `{ id, providerOptionsOverrides }`; normalize both before constructing gateway models.
- `packages/agent/index.ts` - export any new public config types needed by the web app.
- `apps/web/app/api/chat/route.ts` - pass resolved model selections, including provider overrides, into `createOpenHarnessAgent` instead of instantiating/validating them locally.
- `apps/web/app/api/chat/route.test.ts` - update or add assertions around the new factory call shape if needed.
- `packages/agent/*.test.ts` - add focused coverage for selection normalization if the package lacks it.

Verification:
- Run `bun run --filter @open-harness/agent typecheck`
- Run `bun run --filter web typecheck`
- Run `bun test apps/web/app/api/chat/route.test.ts`
- Run `bun run ci`
- Edge cases: plain model IDs still work; missing variants still fall back to default model ID; provider overrides apply only when present; subagent model falls back correctly when unset.
