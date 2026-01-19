# Saved Tool Approval Preferences

This plan uses the call options pattern (like `autoApprove`) to pass approval
rules from the client to the agent's `needsApproval` functions via
`sharedContext`.

## Current State

- `autoApprove` is already passed via call options and stored in `sharedContext`
- Transport calls `getAutoApprove()` at request time to get current mode
- Each tool's `needsApproval` function reads `sharedContext.autoApprove`
- "Yes, and don't ask again" in `ApprovalPanel` is a placeholder

## Goals

1. Persist approval patterns within a session so "don't ask again" suppresses
   repeat prompts for similar requests.
2. Auto-approve when a session rule matches a tool request.
3. Keep a clear UI path to save and clear preferences.
4. Preserve safety defaults for paths outside the working directory.

## Approach

Follow the existing `autoApprove` pattern:

1. Define approval rules schema and add `approvalRules` to call options
2. Store rules in `sharedContext` via `prepareCall`
3. Update each tool's `needsApproval` function to check rules
4. On the client, keep rules in state/ref and pass via transport

## Data Model

```typescript
// Rule types for different tools
type ApprovalRule =
  | { type: "command-prefix"; tool: "bash"; prefix: string }
  | { type: "path-glob"; tool: "write" | "edit" | "read" | "grep" | "glob"; glob: string }
  | { type: "subagent-type"; tool: "task"; subagentType: "executor" | "explorer" };

type ApprovalRules = ApprovalRule[];
```

Example rules:

```json
[
  { "type": "command-prefix", "tool": "bash", "prefix": "bun test" },
  { "type": "path-glob", "tool": "write", "glob": "src/**" },
  { "type": "subagent-type", "tool": "task", "subagentType": "executor" }
]
```

## Implementation Plan

### Phase 1: Add Approval Rules to Call Options

Files: `src/agent/deep-agent.ts`, `src/agent/utils/shared-context.ts`, `src/agent/types.ts`

1. Add `ApprovalRule` type to `src/agent/types.ts`
2. Add `approvalRulesSchema` to `callOptionsSchema` in deep-agent.ts
3. Add `approvalRules: ApprovalRule[]` to `sharedContext`
4. Update `prepareCall` to set `sharedContext.approvalRules`

### Phase 2: Update needsApproval Functions

Files: `src/agent/tools/file-system/bash.ts`, `src/agent/tools/file-system/write.ts`,
`src/agent/tools/file-system/read.ts`, `src/agent/tools/file-system/grep.ts`,
`src/agent/tools/file-system/glob.ts`, `src/agent/tools/task-delegation/task.ts`

Add rule matching to each tool's approval function:

```typescript
// bash.ts - check command-prefix rules
function createBashApprovalFn(options?: ToolOptions): ApprovalFn {
  return async (args) => {
    // ... existing checks ...
    
    // Check approval rules
    for (const rule of sharedContext.approvalRules) {
      if (rule.type === "command-prefix" && rule.tool === "bash") {
        if (args.command.trim().startsWith(rule.prefix)) {
          return false; // auto-approve
        }
      }
    }
    
    // ... rest of existing logic ...
  };
}
```

Similar patterns for:
- `write.ts` / `edit.ts`: match `path-glob` rules against file path
- `read.ts` / `grep.ts` / `glob.ts`: match `path-glob` rules
- `task.ts`: match `subagent-type` rules

### Phase 3: Client-Side State Management

Files: `src/tui/chat-context.tsx`, `src/tui/transport.ts`, `src/tui/types.ts`

1. Add `ApprovalRule[]` state and ref in `ChatProvider`
2. Add `addApprovalRule` and `clearApprovalRules` functions to context
3. Pass `getApprovalRules` callback to transport (like `getAutoApprove`)
4. Update transport to include `approvalRules` in call options

```typescript
// chat-context.tsx
const [approvalRules, setApprovalRules] = useState<ApprovalRule[]>([]);
const approvalRulesRef = useRef(approvalRules);
approvalRulesRef.current = approvalRules;

const addApprovalRule = (rule: ApprovalRule) => {
  setApprovalRules((prev) => [...prev, rule]);
};

// transport.ts
const approvalRules = getApprovalRules?.() ?? [];
const result = await agent.stream({
  messages: prunedMessages,
  options: { ...agentOptions, autoApprove, approvalRules },
  // ...
});
```

### Phase 4: Rule Inference + "Don't Ask Again"

Files: `src/tui/components/approval-panel.tsx`, `src/tui/components/tool-call.tsx`

1. Add `inferApprovalRule(toolName, args)` helper that creates a rule from tool args:
   - bash: extract first 1-2 tokens as `command-prefix`
   - write/edit: extract directory as `path-glob` (e.g., `src/components/**`)
   - task: create `subagent-type` rule for executor

2. Update `ApprovalPanel` to:
   - Infer a rule candidate when displaying
   - On "Yes, and don't ask again": call `addApprovalRule(inferredRule)` then approve
   - Show the inferred pattern in the button label

## Files to Modify

**Agent (server-side):**
- `src/agent/types.ts` - add `ApprovalRule` type
- `src/agent/utils/shared-context.ts` - add `approvalRules` to context
- `src/agent/deep-agent.ts` - add to call options schema and prepareCall
- `src/agent/tools/file-system/bash.ts` - check rules in approval fn
- `src/agent/tools/file-system/write.ts` - check rules for write/edit
- `src/agent/tools/file-system/read.ts` - check rules
- `src/agent/tools/file-system/grep.ts` - check rules
- `src/agent/tools/file-system/glob.ts` - check rules
- `src/agent/tools/task-delegation/task.ts` - check rules

**TUI (client-side):**
- `src/tui/types.ts` - re-export `ApprovalRule` type
- `src/tui/chat-context.tsx` - state, ref, and context functions
- `src/tui/transport.ts` - pass rules in call options
- `src/tui/components/approval-panel.tsx` - infer rules, handle "don't ask again"

## User Experience

1. Tool requests approval, ApprovalPanel shows pattern (e.g., "bun test")
2. User selects "Yes, and don't ask again for `bun test`"
3. Rule is added to state, request is approved
4. Next request with same pattern: rule sent via call options, `needsApproval`
   returns false, no approval UI shown

## Security Considerations

- Rules only skip approval for paths within working directory
- Outside-cwd paths always require manual approval (rules ignored)
- Bash safety patterns still apply (rules only affect the approval check, not
  the underlying safety list)
- Rules are session-only, not persisted to disk

## Validation

- Unit test rule matching logic in each tool's approval function
- Manual: approve `bun test` once, confirm next `bun test` auto-approves
- Manual: confirm write/edit auto-approval only works within cwd
- Manual: confirm outside-cwd paths still require approval
