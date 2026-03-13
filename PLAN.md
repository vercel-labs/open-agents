Summary: Keep `createOpenHarnessAgent` fully synchronous and serializable by storing sandbox state in agent context, and lazily reconnect to the live sandbox inside tool/context helpers instead of inside the factory.

Context: The current split is between serializable agent construction and runtime tool execution. `packages/agent/open-harness-agent.ts` should not perform async sandbox reconnection if the goal is a pure serializable factory. Today, tools read a live `Sandbox` from `experimental_context` via `packages/agent/tools/utils.ts`, and subagents also receive a live sandbox directly. The sandbox package already provides serializable `SandboxState` plus `connectSandbox(...)`, so the missing piece is a lazy runtime resolver at the tool boundary.

Approach: Revert the async factory direction. Make `createOpenHarnessAgent` accept a serializable sandbox context object built from `SandboxState` plus prompt-relevant fields needed synchronously (e.g. `workingDirectory`, `currentBranch`, `environmentDetails`). Store that serializable sandbox context in `experimental_context`. Then change tool/subagent sandbox accessors so they resolve a live sandbox on demand from the stored state, ideally with per-agent/per-request memoization so repeated tool calls do not reconnect repeatedly.

Changes:
- `packages/agent/open-harness-agent.ts` - make/keep the factory synchronous; accept serializable sandbox context instead of live `Sandbox`; use prompt fields from that context when building instructions; store sandbox state/context in `experimental_context`.
- `packages/agent/types.ts` - replace the live-sandbox-only `AgentContext` shape with a serializable sandbox context/state shape and any cached/live fields needed for lazy connection.
- `packages/agent/tools/utils.ts` - replace `getSandbox`/`getSandboxContext` with async lazy resolution from sandbox state via `connectSandbox(...)`; add memoization so multiple tool calls share one live connection; update helper signatures accordingly.
- `packages/agent/tools/*.ts` - update every tool that reads sandbox context to await the new async helpers.
- `packages/agent/tools/task.ts` and `packages/agent/subagents/*.ts` - ensure subagents also receive the serializable sandbox context and resolve the live sandbox lazily through the same helper path.
- `apps/web/app/config.ts` - use the new serializable sandbox context directly, removing fake casts.
- `apps/web/app/api/chat/route.ts` - pass serializable sandbox context/state into the factory while keeping any request-scoped reconnect logic outside if needed.
- Tests in `packages/agent/tools/*.test.ts`, `packages/agent/tools/utils.test.ts`, and `apps/web/app/api/chat/route.test.ts` - update for async sandbox resolution and lazy connection behavior.

Verification:
- Run targeted tool utility and chat route tests.
- Run package typechecks.
- Run `bun run ci` after implementation.
- Edge cases: repeated tool calls reuse one connection; approval checks can still access working directory synchronously from serializable context; prompt generation still works without reconnecting; subagents can execute tool calls with the same lazy sandbox resolution path.