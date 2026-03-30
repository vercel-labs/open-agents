Summary: Centralize subagent identity metadata in a single registry so the same names and short descriptions can be reused everywhere prompts and tool descriptions reference subagents. Keep all other behavior-specific guidance local to each prompt/tool.

Context: Subagent-facing copy is currently duplicated across packages/agent/tools/task.ts, packages/agent/subagents/explorer.ts, packages/agent/subagents/executor.ts, and potentially the delegation section in packages/agent/system-prompt.ts. That duplication already caused drift in at least one adjacent area (task tool copy says 30 steps while the actual subagents use 100). The desired abstraction is intentionally small: a single place to define each subagent's name and short description, then inject those values dynamically anywhere they are mentioned.

Approach: Add a lightweight subagent registry with only the shared identity fields needed across surfaces. Use helper functions to format those entries for the task tool description, the parent system prompt's delegation section, and the top identity line in each subagent prompt. Keep capability rules, behavioral instructions, validation requirements, and any read-only/full-access constraints hardcoded in the specific prompt/tool that owns them. Keep one shared subagent step limit constant, but do not model capabilities or access policy in the registry.

Changes:
- `packages/agent/subagents/registry.ts` - new single source of truth for subagent ids, display names, short descriptions, and shared step limit; export helper utilities for rendering subagent summaries.
- `packages/agent/tools/task.ts` - build the `subagentType` enum/options and human-readable subagent summary text from the registry instead of hardcoding names/descriptions inline.
- `packages/agent/subagents/explorer.ts` - use the shared step limit and pull the opening subagent identity text from the registry; keep read-only behavior rules local.
- `packages/agent/subagents/executor.ts` - use the shared step limit and pull the opening subagent identity text from the registry; keep implementation/validation rules local.
- `packages/agent/system-prompt.ts` - generate the parent prompt's subagent/delegation summary from the same registry so names/descriptions stay aligned.
- `packages/agent/tools/tools.test.ts` - update tests to cover the registry-driven subagent list and explicit blanket-accept behavior.
- `packages/agent/system-prompt.test.ts` (if added) - optional focused test for generated subagent prompt copy.

Verification:
- Run `bun run typecheck`.
- Run `bun run test:isolated`.
- If prompt-generation tests are added or broader integration coverage changes, run `bun run ci`.
- Manually confirm the same name/short-description strings appear consistently in the task tool description, subagent prompt headers, and parent system prompt output.
