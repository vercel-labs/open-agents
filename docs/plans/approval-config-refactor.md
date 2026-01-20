# Plan: Refactor Approval Config to Discriminated Union

**Status:** Incomplete / Not Implemented

## Problem

The current approval configuration uses three separate fields with implicit interactions:

```typescript
interface AgentContext {
  sandbox: Sandbox;
  mode: AgentMode;           // "interactive" | "background"
  autoApprove: AutoApprove;  // "off" | "edits" | "all"
  approvalRules: ApprovalRule[];
}
```

Issues:
- When `mode: "background"`, both `autoApprove` and `approvalRules` are redundant
- When `autoApprove: "all"`, `approvalRules` is redundant
- Subagents awkwardly set `autoApprove: "all"` to mean "delegated trust"
- Approval logic is scattered with implicit precedence rules
- Context shape doesn't match between main agent and subagents (subagents omit `mode` and `approvalRules`, relying on defaults)

## Proposed Solution

Use a discriminated union that makes the trust model explicit:

```typescript
type ApprovalConfig =
  | {
      type: "interactive";
      autoApprove: "off" | "edits" | "all";
      sessionRules: ApprovalRule[];
    }
  | { type: "background" }
  | { type: "delegated" };

interface AgentContext {
  sandbox: Sandbox;
  approval: ApprovalConfig;
}
```

Benefits:
- No redundant fields - `background` and `delegated` don't carry unused `approvalRules`
- Self-documenting - subagents use `type: "delegated"` which explains why they auto-approve
- Type-safe - can't accidentally set `approvalRules` on a background context
- Simpler logic - switch statements make precedence obvious

## Approval Logic

The current scattered logic:

```typescript
// Current (implicit precedence)
if (commandMatchesApprovalRule(command, ctx.approvalRules)) return false;
if (ctx.mode === "background") return false;
if (ctx.mode === "interactive" && ctx.autoApprove === "all") return false;
return commandNeedsApproval(command);
```

Becomes:

```typescript
function shouldApproveCommand(command: string, approval: ApprovalConfig): boolean {
  switch (approval.type) {
    case "background":
    case "delegated":
      return false; // Full trust within sandbox

    case "interactive":
      if (commandMatchesApprovalRule(command, approval.sessionRules)) {
        return false;
      }
      if (approval.autoApprove === "all") {
        return false;
      }
      return commandNeedsApproval(command);
  }
}
```

## Files to Modify

### Type definitions
- `packages/agent/types.ts` - Define `ApprovalConfig`, update `AgentContext`

### Context management
- `packages/agent/tools/utils.ts` - Update `getApprovalContext()` return type and logic

### Main agent
- `packages/agent/deep-agent.ts` - Update schemas and context creation

### Tools (update `needsApproval` logic)
- `packages/agent/tools/bash/shared.ts` - Update `CommandApprovalContext` and `shouldApproveCommand`
- `packages/agent/tools/write.ts` - Update write and edit tool approval
- `packages/agent/tools/task.ts` - Update task tool approval
- `packages/agent/tools/read.ts` - Update read tool approval
- `packages/agent/tools/glob.ts` - Update glob tool approval
- `packages/agent/tools/grep.ts` - Update grep tool approval

### Subagents
- `packages/agent/subagents/executor.ts` - Use `{ type: "delegated" }`
- `packages/agent/subagents/explorer.ts` - Use `{ type: "delegated" }`

## Implementation Steps

### Step 1: Define new types (`types.ts`)

```typescript
export type ApprovalConfig =
  | {
      type: "interactive";
      autoApprove: "off" | "edits" | "all";
      sessionRules: ApprovalRule[];
    }
  | { type: "background" }
  | { type: "delegated" };

export interface AgentContext {
  sandbox: Sandbox;
  approval: ApprovalConfig;
}
```

Keep `AgentMode`, `AutoApprove` exported for backward compatibility during migration.

### Step 2: Update `getApprovalContext()` (`utils.ts`)

Change return type and add helper functions:

```typescript
export function getApprovalConfig(
  experimental_context: unknown,
  toolName?: string,
): { sandbox: Sandbox; approval: ApprovalConfig } {
  // Extract and validate context
  // Return normalized approval config
}

// Helper for common approval checks
export function shouldAutoApprove(config: ApprovalConfig): boolean {
  return config.type === "background" || config.type === "delegated";
}

export function getSessionRules(config: ApprovalConfig): ApprovalRule[] {
  return config.type === "interactive" ? config.sessionRules : [];
}
```

### Step 3: Update `deep-agent.ts`

Update schema and context creation:

```typescript
const approvalConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("interactive"),
    autoApprove: z.enum(["off", "edits", "all"]).default("off"),
    sessionRules: z.array(approvalRuleSchema).default([]),
  }),
  z.object({ type: z.literal("background") }),
  z.object({ type: z.literal("delegated") }),
]);

// In prepareCall:
experimental_context: { sandbox, approval: options.approval }
```

### Step 4: Update tool approval logic

Replace scattered checks with clean switch statements in each tool file.

### Step 5: Update subagents

```typescript
// executor.ts and explorer.ts
experimental_context: {
  sandbox,
  approval: { type: "delegated" },
}
```

## Verification

1. Run typecheck: `turbo typecheck --filter=@open-harness/agent`
2. Run lint: `turbo lint --filter=@open-harness/agent`
3. Manual test scenarios:
   - Interactive mode with `autoApprove: "off"` - dangerous commands should require approval
   - Interactive mode with `autoApprove: "all"` - all commands auto-approved
   - Background mode - all commands auto-approved
   - Subagent (delegated) - all commands auto-approved
   - Session rules - matching commands bypass approval

## Appendix: Current Approval Usage Locations

| File | Line(s) | Usage |
|------|---------|-------|
| `types.ts` | 22, 31, 33-38 | Type definitions |
| `deep-agent.ts` | 26-27, 29-32, 94-97, 122 | Schema and context creation |
| `utils.ts` | 65-68, 77-79, 89-117 | `getMode()`, `isBackgroundMode()`, `getApprovalContext()` |
| `write.ts` | 93-127, 188-222 | `needsApproval` for write and edit tools |
| `bash/shared.ts` | 42-55, 183-211 | `commandMatchesApprovalRule`, `shouldApproveCommand` |
| `task.ts` | 29-62 | `subagentMatchesApprovalRule`, `needsApproval` |
| `glob.ts` | 121-172 | `pathMatchesApprovalRule`, `needsApproval` |
| `grep.ts` | 112-159 | `pathMatchesApprovalRule`, `needsApproval` |
| `read.ts` | 66-112 | `pathMatchesApprovalRule`, `needsApproval` |
| `executor.ts` | 92-96 | Context setup (sets `autoApprove: "all"`) |
| `explorer.ts` | 103-107 | Context setup (sets `autoApprove: "all"`) |
