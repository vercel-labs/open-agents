# Tool Approval System

This document explains the current, simplified approval model used in `packages/agent`.

## Overview

The agent no longer differentiates between multiple runtime approval modes. The product now effectively runs in the cloud, so `packages/agent` keeps only the minimum approval state needed for bash safety.

## Bash Approval Context

The agent context now carries only the minimum bash approval inputs:

```typescript
interface AgentContext {
  sandbox: Sandbox;
  model: LanguageModel;
  allowAllBash?: boolean;
  bashRules?: Array<{
    type: "command-prefix";
    tool: "bash";
    prefix: string;
  }>;
}
```

### `bashRules`

Command-prefix rules that auto-approve matching bash commands. Example:

```typescript
{ type: "command-prefix", tool: "bash", prefix: "bun run" }
```

### `allowAllBash`

When `true`, all bash commands are auto-approved for the current execution context. This is primarily used by subagents.

## Approval Flow

Only bash uses approval checks today:

```
Bash tool called
    ↓
Is allowAllBash enabled? ── Yes ──→ Auto-approve
    ↓ No
Matches a bashRules prefix? ── Yes ──→ Auto-approve
    ↓ No
Is cwd outside working directory? ── Yes ──→ Needs approval
    ↓ No
Does the command match a dangerous pattern? ── Yes ──→ Needs approval
    ↓ No
Auto-approve
```

## Bash Tool Logic

The bash tool applies approval in this order:

1. Auto-approve if `allowAllBash` is enabled
2. Auto-approve if the command matches a configured prefix rule
3. Require approval if `cwd` escapes the sandbox working directory
4. Require approval for dangerous commands and unknown commands
5. Auto-approve known safe read-only commands

See `packages/agent/tools/bash.ts` for the concrete implementation.

## Subagents

Subagents run with:

```typescript
allowAllBash: true
```

This lets them execute bash autonomously inside the sandbox without carrying any separate mode concept.

## Helper Functions

### `shouldAutoApprove(options): boolean`

Returns `true` when `allowAllBash` is enabled.

### `getApprovalContext(experimental_context, toolName?)`

Extracts sandbox, working directory, and approval config from the AI SDK context.

## Key Files

| File | Purpose |
| --- | --- |
| `packages/agent/types.ts` | `ApprovalConfig` type |
| `packages/agent/tools/utils.ts` | Approval helpers |
| `packages/agent/tools/bash.ts` | Bash approval logic |
| `packages/agent/subagents/executor.ts` | Subagent bash auto-approval |
| `packages/agent/subagents/explorer.ts` | Subagent bash auto-approval |
