# Tool Approval System

This document explains how tool approvals work in Open Harness.

## Overview

The approval system controls when tools require user confirmation before executing. It uses a discriminated union pattern to make trust models explicit and type-safe.

## Approval Configuration

The `ApprovalConfig` type defines three trust models:

```typescript
type ApprovalConfig =
  | {
      type: "interactive";
      autoApprove: "off" | "edits" | "all";
      sessionRules: ApprovalRule[];
    }
  | { type: "background" }
  | { type: "delegated" };
```

### Interactive Mode

Used for local development with human oversight.

- **`autoApprove: "off"`** - All potentially dangerous operations require approval
- **`autoApprove: "edits"`** - Write/edit operations inside the working directory auto-approve
- **`autoApprove: "all"`** - All operations inside the working directory auto-approve
- **`sessionRules`** - User-created rules that persist for the session

### Background Mode

Used for async cloud execution (e.g., Vercel sandbox). Auto-approves all tools because safety relies on git checkpointing rather than interactive approval.

### Delegated Mode

Used by subagents that inherit trust from their parent agent. Auto-approves all tools unconditionally.

## Approval Rules

Session rules allow users to grant persistent approval for specific patterns. Rules use a discriminated union with three types:

```typescript
type ApprovalRule =
  | { type: "command-prefix"; tool: "bash"; prefix: string }
  | {
      type: "path-glob";
      tool: "read" | "write" | "edit" | "grep" | "glob";
      glob: string;
    }
  | {
      type: "subagent-type";
      tool: "task";
      subagentType: "explorer" | "executor";
    };
```

### Command Prefix Rules

For the bash tool. If a command starts with the prefix, it auto-approves.

```typescript
{ type: "command-prefix", tool: "bash", prefix: "npm test" }
```

### Path Glob Rules

For file-based tools. If a file path matches the glob pattern, it auto-approves.

```typescript
{ type: "path-glob", tool: "write", glob: "src/**/*.ts" }
```

### Subagent Type Rules

For the task tool. If the subagent type matches, it auto-approves.

```typescript
{ type: "subagent-type", tool: "task", subagentType: "executor" }
```

## Approval Flow

```
Tool Called
    ↓
needsApproval() function runs
    ↓
┌─────────────────────────────────────┐
│ Is approval type "background"       │──Yes──→ Auto-approve
│ or "delegated"?                     │
└──────────────┬──────────────────────┘
               │ No (interactive mode)
               ↓
┌─────────────────────────────────────┐
│ Does operation match a session rule?│──Yes──→ Auto-approve
└──────────────┬──────────────────────┘
               │ No
               ↓
      Tool-specific logic
               ↓
┌─────────────────────────────────────┐
│ Approval needed?                    │──Yes──→ Show approval panel
└──────────────┬──────────────────────┘
               │ No
               ↓
         Auto-approve
```

## Tool-Specific Logic

### Write and Edit Tools

1. Check session rules (can match any path, inside or outside working directory)
2. If path is outside working directory → needs approval
3. If inside working directory, check `autoApprove` setting:
   - `"edits"` or `"all"` → auto-approve
   - `"off"` → needs approval

```typescript
// Simplified logic from pathNeedsApproval()
if (pathMatchesApprovalRule(path, tool, sessionRules)) return false;
if (!isInsideWorkingDir) return true;
if (autoApprove === "edits" || autoApprove === "all") return false;
return true;
```

### Read, Grep, Glob Tools

1. If path is inside working directory → auto-approve
2. If outside, check session rules
3. If no matching rule → needs approval

```typescript
// Simplified logic from pathNeedsApproval()
if (isInsideWorkingDir) return false;
if (pathMatchesApprovalRule(path, tool, sessionRules)) return false;
return true;
```

### Bash Tool

1. Check session rules for command prefix match
2. If `cwd` is outside working directory → needs approval
3. If `autoApprove === "all"` → auto-approve all commands
4. Check command against safe/dangerous patterns:
   - Safe commands (ls, cat, git status, etc.) → auto-approve
   - Dangerous patterns (rm, git push, pipes, etc.) → needs approval

```typescript
// Simplified logic
if (commandMatchesApprovalRule(command, sessionRules)) return false;
if (cwdIsOutsideWorkingDirectory(cwd)) return true;
if (autoApprove === "all") return false;
return commandNeedsApproval(command);
```

### Task Tool (Subagents)

1. Explorer subagent → never needs approval (read-only)
2. Executor subagent:
   - Check session rules for subagent-type match
   - Otherwise → needs approval

```typescript
// Simplified logic
if (subagentType !== "executor") return false;
if (subagentMatchesApprovalRule(subagentType, sessionRules)) return false;
return true;
```

## Subagent Trust Delegation

Subagents inherit trust from the parent agent by using `{ type: "delegated" }`:

```typescript
// From executor.ts and explorer.ts
prepareCall: ({ options, ...settings }) => ({
  ...settings,
  experimental_context: {
    sandbox,
    approval: { type: "delegated" },
  },
});
```

This means:

- Individual tool calls within subagents auto-approve
- Approval happens at the task level (executor requires approval before spawning)
- Once approved, the subagent runs autonomously

## Helper Functions

Located in `packages/agent/tools/utils.ts`:

### `shouldAutoApprove(approval: ApprovalConfig): boolean`

Type guard that returns `true` for background and delegated modes. Use this first in `needsApproval` functions.

```typescript
if (shouldAutoApprove(approval)) {
  return false; // Auto-approve
}
// TypeScript now knows approval.type === "interactive"
```

### `getApprovalContext(experimental_context, toolName?)`

Extracts sandbox, workingDirectory, and approval config from the AI SDK context. Throws descriptive errors if context is missing.

### `pathNeedsApproval(options: PathApprovalOptions): boolean`

Consolidated logic for path-based tools (read, write, edit, grep, glob). Handles:

- Session rule matching
- Working directory boundary checks
- autoApprove setting logic

### `pathMatchesApprovalRule(path, tool, workingDirectory, rules): boolean`

Checks if a file path matches any path-glob rules for the given tool.

### `pathMatchesGlob(path, glob, baseDir, options?): boolean`

Converts glob patterns to regex and tests paths. Supports `**` for recursive matching.

## Key Files

| File                                   | Purpose                                |
| -------------------------------------- | -------------------------------------- |
| `packages/agent/types.ts`              | `ApprovalConfig`, `ApprovalRule` types |
| `packages/agent/tools/utils.ts`        | Helper functions for approval logic    |
| `packages/agent/tools/write.ts`        | Write and edit tool approval           |
| `packages/agent/tools/read.ts`         | Read tool approval                     |
| `packages/agent/tools/bash.ts`         | Bash tool approval with command safety |
| `packages/agent/tools/grep.ts`         | Grep tool approval                     |
| `packages/agent/tools/glob.ts`         | Glob tool approval                     |
| `packages/agent/tools/task.ts`         | Task tool approval for subagents       |
| `packages/agent/subagents/executor.ts` | Executor with delegated approval       |
| `packages/agent/subagents/explorer.ts` | Explorer with delegated approval       |

## Design Decisions

1. **Discriminated unions over boolean flags**: Makes trust models explicit and eliminates implicit precedence rules.

2. **Type guards**: `shouldAutoApprove()` enables TypeScript to narrow types after the check.

3. **Path-based approval**: Allows granular rules like "approve all writes in src/\*\*" without per-file prompts.

4. **Delegated trust**: Subagents inherit trust, avoiding repeated approval for nested operations.

5. **Session-scoped rules**: Users can create rules during a session that persist until the session ends.

6. **Safe by default**: Unknown commands and paths outside working directory require approval.
