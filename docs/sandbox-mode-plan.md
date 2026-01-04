# Sandbox Mode Plan

## Problem Statement

The current sandbox implementation has a fundamental lifecycle mismatch between local and cloud environments:

| Aspect | LocalSandbox | VercelSandbox |
|--------|--------------|---------------|
| Persistence | Automatic (filesystem) | None (ephemeral VM) |
| Working directory | User's actual path | Always `/vercel/sandbox` |
| State across turns | Preserved | Lost on `stop()` |
| Use case | Local development | Web app (future) |

When a cloud sandbox is stopped (end of turn, timeout, token limit), all uncommitted work is lost. The agent may have:
- Installed dependencies
- Made file changes
- Built artifacts
- Partially completed work

None of this survives sandbox destruction.

## Proposed Solution: Agent Modes

Introduce a `mode` option that changes agent behavior based on the execution context.

### Mode Definitions

```typescript
type AgentMode =
  | 'interactive'  // Human in the loop, local development
  | 'background'   // Async execution, cloud sandbox
```

### Behavior by Mode

| Aspect | `interactive` | `background` |
|--------|---------------|--------------|
| Tool approval | Required for writes/bash | Auto-approve all |
| System prompt | Standard | + Checkpointing instructions |
| Sandbox assumption | Persistent (local) | Ephemeral (cloud) |
| Git behavior | Commit when asked | Commit frequently, push always |
| Error handling | Surface to user | Retry, then checkpoint & report |

## Implementation Plan

### 1. Update Agent Options Schema

Add `mode` to the call options:

```typescript
const callOptionsSchema = z.object({
  workingDirectory: z.string(),
  mode: z.enum(['interactive', 'background']).default('interactive'),
  customInstructions: z.string().optional(),
  todos: z.array(todoItemSchema).optional(),
  scratchpad: z.map(z.string(), scratchpadEntrySchema).optional(),
  sandbox: z.custom<Sandbox>().optional(),
});
```

### 2. Update Tool Factories

Tools need to check mode for approval decisions:

```typescript
// Current
writeFileTool({ needsApproval: true })

// Updated
writeFileTool({
  needsApproval: (context) => context.mode === 'interactive'
})
```

This requires passing `mode` through the experimental context:

```typescript
experimental_context: { sandbox, mode }
```

### 3. Update System Prompt Builder

Add mode parameter and conditional instructions:

```typescript
function buildSystemPrompt({
  cwd,
  mode,
  customInstructions,
  todosContext,
  scratchpadContext
}) {
  let prompt = buildBasePrompt({ cwd, customInstructions, todosContext, scratchpadContext });

  if (mode === 'background') {
    prompt += '\n\n' + BACKGROUND_MODE_INSTRUCTIONS;
  }

  return prompt;
}
```

### 4. Background Mode Instructions

```markdown
## Background Mode - Ephemeral Sandbox

Your sandbox is ephemeral. All work is lost when the session ends unless committed and pushed to git.

### Checkpointing Rules

1. **Commit after every meaningful change** - new file, completed function, fixed bug
2. **Push immediately after each commit** - don't batch commits
3. **Commit BEFORE long operations** - pnpm install, builds, test runs
4. **Use clear WIP messages** - "WIP: add user authentication endpoint"
5. **When in doubt, checkpoint** - it's better to have extra commits than lost work

### Git Workflow

- You are on branch: `{currentBranch}`
- Push with: `git push -u origin {currentBranch}`
- Your work is only safe once pushed to remote

### On Task Completion

- Squash WIP commits into logical units if appropriate
- Write a final commit message summarizing changes
- Ensure all changes are pushed before reporting completion
```

### 5. Expose Current Branch

The `VercelSandbox` already tracks `currentBranch`. Ensure this is:
- Passed to the system prompt builder
- Available to the agent for push commands

```typescript
instructions: buildSystemPrompt({
  cwd: sandbox.workingDirectory,
  mode,
  currentBranch: sandbox.currentBranch,
  // ...
}),
```

## Files to Modify

1. **`src/agent/deep-agent.ts`**
   - Add `mode` to call options schema
   - Pass mode to system prompt builder
   - Include mode in experimental context

2. **`src/agent/system-prompt.ts`**
   - Add mode parameter
   - Add background mode instructions
   - Include currentBranch in prompt when available

3. **`src/agent/tools/index.ts`** (or individual tool files)
   - Update approval functions to check mode from context

4. **`src/agent/utils.ts`**
   - Add helper to get mode from context

## Edge Cases & Considerations

### 1. Commit Noise

Background mode will create many WIP commits. Options:
- Accept it as the cost of reliability
- Instruct agent to squash before final PR
- Provide a "squash checkpoint commits" tool

### 2. Mid-Operation Timeout

If sandbox dies during `pnpm install`, there's no checkpoint. Mitigation:
- Instruct agent to commit BEFORE risky operations
- Consider exposing `sandbox.remainingTimeMs` in the future

### 3. Push Failures

Network issues or auth problems could prevent pushing. The agent should:
- Retry once or twice
- Report the failure clearly if it persists
- Not proceed with more work until push succeeds

### 4. No Branch Configured

If the sandbox wasn't created with a `newBranch`, the agent might be on `main`. Options:
- Instruct agent to create a working branch first
- Require `newBranch` for background mode
- Warn but allow (risky)

### 5. Large Files / Binary Files

Git isn't great for large or binary files. The agent should:
- Avoid committing node_modules, build artifacts
- Use `.gitignore` appropriately
- Be aware that some work (installed deps) can't be checkpointed

## Future Considerations

### Supervised Mode

A potential third mode for scenarios where you want some automation but still want approval for destructive operations:

```typescript
type AgentMode =
  | 'interactive'  // Approve all writes
  | 'background'   // Auto-approve all
  | 'supervised'   // Auto-approve reads, approve writes
```

### Sandbox State Serialization

For more complex persistence needs, could serialize sandbox state:
- List of modified files
- Uncommitted changes (as patches)
- Environment state

This would allow restoring a sandbox without relying solely on git.

### Time Awareness

Expose remaining sandbox time to the agent:
- "You have approximately 2 minutes remaining"
- Allows agent to prioritize checkpointing as time runs low
