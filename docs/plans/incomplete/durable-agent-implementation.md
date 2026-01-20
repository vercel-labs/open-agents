# Durable Agent Implementation

This document describes the implementation of durable agent workflows using the Workflow framework to enable persistence, resumability, and reliability for long-running agent tasks.

## Objective

Migrate the agent execution system from a simple request-response model to a **durable workflow** approach that provides:

1. **Persistence**: Agent execution state persists across disconnections or page reloads
2. **Resumability**: Clients can reconnect to ongoing workflows and resume receiving streaming updates
3. **Long-running task support**: Sandbox operations can run for extended periods with graceful recovery
4. **Better reliability**: Workflow framework handles task durability, state management, and reconnection logic

## Previous Architecture

The previous `DefaultChatTransport` used a simple request-response model:

```
┌─────────────────────────┐
│  Client (React)         │
│  - DefaultChatTransport │
└───────────┬─────────────┘
            │
            ▼
┌───────────────────────────┐
│  POST /api/chat           │
│  - Run agent once         │
│  - Stream response        │
│  - No persistence         │
└───────────────────────────┘
```

**Limitations:**
- No durability or resumability
- Disconnection meant loss of agent execution context
- No support for reconnecting to in-progress tasks

## New Architecture

The new architecture uses `WorkflowChatTransport` with durable workflows:

```
┌─────────────────────────────────────────────────────────────────┐
│  Client (React)                                                 │
│  - WorkflowChatTransport (from @workflow/ai)                   │
│  - Stores workflow run ID in localStorage                      │
│  - Can resume via stored run ID                                │
└─────────────────┬───────────────────────────────────────────────┘
                  │
        ┌─────────┴──────────┐
        │                    │
   /api/chat-durable    /api/chat-durable/[id]/stream
   (POST - start)       (GET - reconnect to existing run)
        │                    │
        └─────────┬──────────┘
                  │
        ┌─────────▼────────────────────────┐
        │  Workflow Framework              │
        │  - Durability                    │
        │  - Persistence                   │
        │  - Step execution                │
        └─────────┬────────────────────────┘
                  │
        ┌─────────▼────────────────────────┐
        │  runDurableAgent()               │
        │  (packages/agent/durable-agent)  │
        │  - "use workflow" directive      │
        │  - Coordinates steps             │
        └─────────┬────────────────────────┘
                  │
        ┌─────────▼────────────────────────┐
        │  streamAgentResponse()           │
        │  (step function)                 │
        │  - "use step" directive          │
        │  - Connects sandbox              │
        │  - Runs deepAgent                │
        │  - Streams UIMessageChunks       │
        └──────────────────────────────────┘
```

## Key Concepts

### Workflow Framework Directives

The Workflow framework uses special directives to identify durable functions:

- **`"use workflow"`**: Marks the entry point of a durable workflow. The framework automatically manages state, durability, and checkpoints.
- **`"use step"`**: Marks individual steps within a workflow. Each step is checkpointed and can be retried on failure.

### Serialization Requirements

All parameters passed to `start(runDurableAgent, [messages, options])` must be JSON-serializable:

- `DurableAgentOptions` uses `SandboxState` (serializable) instead of `Sandbox` (has non-serializable methods/connections)
- GitHub token passed via `sandboxConnectOptions.env.GITHUB_TOKEN` instead of in-memory
- Model ID passed as string, resolved inside the workflow

### Streaming Architecture

- Uses `getWritable<UIMessageChunk>()` to get a WritableStream
- Tools write `UIMessageChunk` objects directly (not JSON-stringified)
- Client reconstructs full message stream via the workflow framework

### Reconnection Support

- Workflow run ID stored in localStorage as `workflow-run-${taskId}`
- Client can call `/api/chat-durable/[id]/stream?startIndex=X` to reconnect
- `startIndex` allows resuming from a specific point in the stream
- `resume: !!activeWorkflowRunId` option in `useChat` enables auto-resume

## File Changes

### New Files

#### `packages/agent/durable-agent.ts`

**Purpose**: Wrapper that enables workflow durability for the agent.

**Key Components**:

```typescript
// Serializable options (unlike DeepAgentCallOptions which contains Sandbox)
interface DurableAgentOptions {
  sandboxState: SandboxState;  // Serializable state instead of live Sandbox
  sandboxConnectOptions?: { env?: Record<string, string> };
  mode: "interactive" | "headless";
  modelId?: string;
  customInstructions?: string;
  approvals?: { autoApprove: "all" | "none" };
}

// Main workflow function
async function runDurableAgent(
  messages: ModelMessage[],
  options: DurableAgentOptions
): Promise<SandboxState | null> {
  "use workflow";

  const writer = getWritable<UIMessageChunk>().getWriter();

  const finalSandboxState = await streamAgentResponse(messages, options, writer);
  await closeStream(writer);

  return finalSandboxState;
}

// Step function that runs the agent
async function streamAgentResponse(
  messages: ModelMessage[],
  options: DurableAgentOptions,
  writer: WritableStreamDefaultWriter<UIMessageChunk>
): Promise<SandboxState | null> {
  "use step";

  // Recreate sandbox from serializable state
  const sandbox = await connectSandbox(options.sandboxState, options.sandboxConnectOptions);

  // Resolve model if specified
  const model = options.modelId ? gateway().languageModel(options.modelId) : undefined;

  // Run the agent
  const result = await deepAgent.stream({ messages, sandbox, model, ... });

  // Stream each chunk
  for await (const chunk of result.uiMessageStream) {
    await writer.write(chunk);
  }

  return sandbox.getState();
}
```

#### `apps/web/app/api/chat-durable/route.ts`

**Purpose**: Entry point that starts new durable workflows.

**Key responsibilities**:
- Validates session and task ownership
- Saves user message immediately (incremental persistence)
- Converts UI messages to model messages
- Starts the workflow via `start(runDurableAgent, [messages, options])`
- Returns workflow stream as `UIMessageChunk` via `createUIMessageStreamResponse()`
- Sets `x-workflow-run-id` header for client-side tracking

```typescript
const run = await start(runDurableAgent, [
  modelMessages,
  {
    sandboxState: task.sandboxState,
    sandboxConnectOptions: githubToken ? { env: { GITHUB_TOKEN: githubToken } } : undefined,
    mode: "interactive",
    modelId: modelId,
    approvals: { autoApprove: "all" },
  },
]);
```

#### `apps/web/app/api/chat-durable/[id]/stream/route.ts`

**Purpose**: Reconnection endpoint to resume existing workflows.

```typescript
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const runId = params.id;
  const startIndex = parseInt(url.searchParams.get("startIndex") ?? "0");

  const run = await getRun<UIMessageChunk>(runId);
  const stream = run.getReadable<UIMessageChunk>({ startIndex });

  return createUIMessageStreamResponse(stream);
}
```

#### `apps/web/app/api/chat-durable/[id]/result/route.ts`

**Purpose**: Fetch final result from completed workflow.

Returns `SandboxState | null` for persistence to database after workflow completes.

#### `apps/web/app/api/chat-durable/persist/route.ts`

**Purpose**: Persist workflow results to database.

Accepts optional `message` (assistant message) and `sandboxState`, saves them to the database.

### Modified Files

#### `apps/web/app/tasks/[id]/task-context.tsx`

**Changes**:
- Replaced `DefaultChatTransport` with `WorkflowChatTransport` from `@workflow/ai`
- Added localStorage-based run ID tracking for resumability
- Enhanced `onChatEnd` callback to fetch final sandbox state and persist
- Updated request preparation functions for the new endpoints

```typescript
const transport = useMemo(() => {
  return new WorkflowChatTransport({
    sendMessagesRequest: { url: "/api/chat-durable" },
    prepareSendMessagesRequest: (body, options) => ({
      body: JSON.stringify({ ...body, taskId: task.id }),
      headers: { "x-model-id": currentModelId },
    }),
    prepareReconnectToStreamRequest: (runId, options, lastEventIndex) => ({
      url: `/api/chat-durable/${runId}/stream?startIndex=${lastEventIndex ?? 0}`,
    }),
    onSendMessagesResponse: (response) => {
      const runId = response.headers.get("x-workflow-run-id");
      if (runId) {
        localStorage.setItem(`workflow-run-${task.id}`, runId);
        workflowRunIdRef.current = runId;
      }
    },
  });
}, [task.id, currentModelId]);

// Resume support
const activeWorkflowRunId = localStorage.getItem(`workflow-run-${task.id}`);

const chat = useChat({
  transport,
  resume: !!activeWorkflowRunId,
  onChatEnd: async () => {
    // Fetch final sandbox state
    const resultResponse = await fetch(`/api/chat-durable/${runId}/result`);
    const sandboxState = await resultResponse.json();

    // Persist to database
    await fetch("/api/chat-durable/persist", {
      method: "POST",
      body: JSON.stringify({ taskId, message, sandboxState }),
    });
  },
});
```

#### `packages/agent/tools/*.ts` (bash, glob, grep, read, write, todo)

**Changes**: Added `"use step"` directive at the start of each `execute` function.

```typescript
export const bashTool = (options?: BashToolOptions) =>
  tool({
    execute: async (args, { experimental_context }) => {
      "use step";  // Added
      const sandbox = getSandbox(experimental_context, "bash");
      // ... rest of implementation
    },
  });
```

This marks each tool execution as a durable step, enabling:
- Retry logic on failure
- State recovery
- Checkpointing

#### `packages/agent/index.ts`

**Changes**: Exported new durable agent function and types.

```typescript
export { runDurableAgent } from "./durable-agent";
export type { DurableAgentOptions } from "./durable-agent";
```

#### `apps/web/next.config.ts`

**Changes**: Added workflow plugin to Next.js config.

```typescript
import { withWorkflow } from "workflow/next";
export default withWorkflow(nextConfig);
```

#### `apps/web/tsconfig.json`

**Changes**: Added workflow plugin to TypeScript compiler options.

```typescript
{
  "compilerOptions": {
    "plugins": [
      { "name": "next" },
      { "name": "workflow" }
    ]
  }
}
```

#### Package Dependencies

**`apps/web/package.json`**:
```json
{
  "dependencies": {
    "workflow": "^4.0.1-beta.48",
    "@workflow/ai": "^4.0.1-beta.49"
  }
}
```

**`packages/agent/package.json`**:
```json
{
  "dependencies": {
    "workflow": "^4.0.1-beta.48"
  }
}
```

**`package.json` (root catalog)**:
```json
{
  "catalog": {
    "@workflow/ai": "^4.0.1-beta.49",
    "workflow": "^4.0.1-beta.48"
  }
}
```

## Flow Diagram

```
1. User sends message
   ↓
2. TaskChatProvider calls WorkflowChatTransport.sendMessage()
   ↓
3. POST /api/chat-durable with { messages, taskId }
   ↓
4. Server validates task ownership and sandbox state
   ↓
5. Server calls start(runDurableAgent, [messages, options])
   ↓
6. Workflow framework creates durable execution
   ↓
7. runDurableAgent() marked with "use workflow"
   ├─ Gets writable stream
   ├─ Calls streamAgentResponse() marked with "use step"
   │  ├─ Recreates sandbox from SandboxState
   │  ├─ Calls deepAgent.stream()
   │  └─ Writes UIMessageChunks to stream
   └─ Closes stream
   ↓
8. Workflow framework streams results to client
   ↓
9. Client receives run ID in x-workflow-run-id header
   ├─ Stores in localStorage (for resume support)
   └─ Stores messages in latestMessagesRef
   ↓
10. When workflow ends (onChatEnd callback):
    ├─ Fetch final sandbox state from /api/chat-durable/[id]/result
    ├─ Persist to database via /api/chat-durable/persist
    └─ Clean up localStorage
```

### Reconnection Flow

```
1. Page reload or disconnect
   ↓
2. Check localStorage for workflow-run-${taskId}
   ↓
3. If found, resume: true passed to useChat
   ↓
4. Call /api/chat-durable/[id]/stream?startIndex=X
   ↓
5. Resume receiving streamed messages
```

## Critical Implementation Details

1. **Tool Durability**: Each tool executes as a durable step, enabling retry logic and state recovery

2. **Sandbox Reconnection**: Using `connectSandbox(state, options)` recreates connection from serialized state

3. **Environment Variables**: GitHub token passed via `sandboxConnectOptions.env.GITHUB_TOKEN` rather than in-memory options

4. **Stream Writing**: Raw `UIMessageChunk` objects written, not JSON-stringified (workflow framework handles serialization)

5. **Return Value**: Final sandbox state returned and accessible via `/api/chat-durable/[id]/result`

6. **Session Validation**: All endpoints verify user session and task ownership before executing

7. **Incremental Persistence**: User messages saved immediately in route handler, assistant messages saved after workflow completes

## Benefits

| Aspect | Before | After |
|--------|--------|-------|
| **Disconnection** | Lost context | Resume from last state |
| **Page reload** | Start over | Continue where left off |
| **Long tasks** | May timeout | Durable execution |
| **Error recovery** | Manual retry | Automatic step retry |
| **State management** | In-memory only | Persistent checkpoints |

## Current Limitations: Step-Level Durability

### The Problem

The current implementation wraps the **entire agent loop** in a single step:

```typescript
async function streamAgentResponse(...) {
  "use step";  // One big step containing entire agent loop

  const sandbox = await connectSandbox(...);
  const result = await deepAgent.stream({ ... });  // Multiple LLM calls + tool executions

  for await (const chunk of result.toUIMessageStream()) {
    await writer.write(chunk);
  }
}
```

This means:

1. If the step fails **after** several tool calls have completed, the workflow framework retries the **entire** `streamAgentResponse` step from the beginning
2. All previously completed tool calls run again (duplicate work, potential side effects)
3. There's no granular checkpointing between tool calls within the agent loop
4. The `"use step"` directives in individual tools are **nested inside** another step - their retry semantics depend on how the workflow framework handles nesting

### Current Durability Status

| Feature | Status | Notes |
|---------|--------|-------|
| Retry entire workflow on failure | ✅ Yes | Via `"use workflow"` |
| Checkpoint before agent loop | ✅ Yes | Step boundary before `streamAgentResponse` |
| Checkpoint between tool calls | ❌ No | All tools execute within one step |
| Retry individual failed tool | ❓ Unclear | Nested steps - depends on framework behavior |
| Resume from middle of agent loop | ❌ No | Would restart entire agent loop |
| Idempotent tool execution | ❌ No | Tools may have side effects on retry |

### Why This Matters

Consider an agent task that:
1. Reads 5 files (tools 1-5)
2. Writes 3 files (tools 6-8)
3. Runs tests (tool 9)
4. **Fails on tool 10** (e.g., network timeout)

With the current implementation, on retry:
- Tools 1-9 all run again
- Files are written again (potentially duplicating work or causing conflicts)
- Tests run again (wasted time)

## Suggested Approach: Granular Step Durability

### Option 1: Step-Per-Tool Architecture

Restructure the agent loop so each tool call is its own top-level workflow step.

**Conceptual approach:**

```typescript
async function runDurableAgent(messages, options) {
  "use workflow";

  const writer = getWritable<UIMessageChunk>().getWriter();
  let currentMessages = messages;
  let sandboxState = options.sandboxState;

  while (true) {
    // Step 1: LLM call to decide next action
    const llmResult = await getLLMResponse(currentMessages, sandboxState);
    await streamChunks(writer, llmResult.chunks);

    if (llmResult.finished) {
      break;
    }

    // Step 2: Execute each tool call as its own step
    for (const toolCall of llmResult.toolCalls) {
      const toolResult = await executeToolStep(toolCall, sandboxState);
      await streamChunks(writer, toolResult.chunks);

      // Update state for next iteration
      currentMessages = [...currentMessages, toolResult.message];
      sandboxState = toolResult.sandboxState;
    }
  }

  await writer.close();
  return sandboxState;
}

// Each tool execution is a separate durable step
async function executeToolStep(toolCall, sandboxState) {
  "use step";

  const sandbox = await connectSandbox(sandboxState);
  const result = await executeTool(toolCall, sandbox);

  return {
    chunks: result.chunks,
    message: result.message,
    sandboxState: sandbox.getState(),
  };
}
```

**Pros:**
- True tool-level durability
- Failed tools retry individually
- Completed tools don't re-execute

**Cons:**
- Breaks streaming pattern (can't stream mid-tool)
- Requires restructuring `deepAgent` internals
- More complex state management between steps
- Higher latency (step checkpointing overhead per tool)

### Option 2: Checkpoint-Based Recovery

Keep the current streaming architecture but add explicit checkpoints that persist agent state.

**Conceptual approach:**

```typescript
async function streamAgentResponse(messages, options, writable) {
  "use step";

  const writer = writable.getWriter();
  const sandbox = await connectSandbox(options.sandboxState);

  // Check for existing checkpoint to resume from
  const checkpoint = await loadCheckpoint(options.workflowId);
  const startingMessages = checkpoint?.messages ?? messages;

  const result = await deepAgent.stream({
    messages: startingMessages,
    options: {
      sandbox,
      // Callback after each tool completes
      onToolComplete: async (toolResult, allMessages) => {
        await saveCheckpoint(options.workflowId, {
          messages: allMessages,
          sandboxState: sandbox.getState(),
        });
      },
    },
  });

  for await (const chunk of result.toUIMessageStream()) {
    await writer.write(chunk);
  }

  // Clear checkpoint on successful completion
  await clearCheckpoint(options.workflowId);

  writer.releaseLock();
  return sandbox.getState();
}
```

**Pros:**
- Preserves streaming architecture
- Less invasive changes to `deepAgent`
- Can resume from last successful tool

**Cons:**
- Not true workflow-level durability (checkpoints are separate)
- Requires checkpoint storage (database or KV)
- Step still retries from beginning, but can skip completed work
- Need to handle partial message streams on resume

### Option 3: Hybrid - Batched Tool Steps

Group tool executions into batched steps (e.g., every 3-5 tools).

```typescript
async function runDurableAgent(messages, options) {
  "use workflow";

  let state = { messages, sandboxState: options.sandboxState };

  while (!state.finished) {
    // Each batch is a durable step
    state = await executeToolBatch(state);
  }

  return state.sandboxState;
}

async function executeToolBatch(state) {
  "use step";

  const sandbox = await connectSandbox(state.sandboxState);
  let currentMessages = state.messages;
  let toolsExecuted = 0;
  const BATCH_SIZE = 5;

  const result = await deepAgent.stream({
    messages: currentMessages,
    options: {
      sandbox,
      shouldYield: () => {
        toolsExecuted++;
        return toolsExecuted >= BATCH_SIZE;  // Yield after N tools
      },
    },
  });

  // Stream and collect results...

  return {
    messages: result.messages,
    sandboxState: sandbox.getState(),
    finished: result.finished,
  };
}
```

**Pros:**
- Balance between durability and overhead
- Limits retry scope to batch size
- Can tune batch size based on needs

**Cons:**
- Still some duplicate work on retry (within batch)
- Requires `shouldYield` mechanism in agent loop
- More complex than current implementation

### Recommendation

**Short term:** Implement **Option 2 (Checkpoint-Based Recovery)** because:
- Minimal changes to existing architecture
- Preserves streaming UX
- Can be implemented incrementally
- Provides meaningful improvement (resume from last tool)

**Long term:** Consider **Option 1 (Step-Per-Tool)** if:
- Checkpoint approach proves insufficient
- Tool executions are expensive (long-running commands)
- Strong guarantees needed for idempotency

### Implementation Checklist for Option 2

1. [ ] Add checkpoint storage (database table or KV store)
2. [ ] Add `onToolComplete` callback to `deepAgent`
3. [ ] Save checkpoint after each successful tool execution
4. [ ] Load checkpoint on workflow resume/retry
5. [ ] Skip already-executed tools based on checkpoint
6. [ ] Handle partial stream reconstruction on resume
7. [ ] Clear checkpoint on successful workflow completion
8. [ ] Add checkpoint TTL/cleanup for abandoned workflows

### Checkpoint Schema

```typescript
interface AgentCheckpoint {
  workflowId: string;
  messages: ModelMessage[];      // All messages including tool results
  sandboxState: SandboxState;    // Sandbox state after last tool
  lastToolIndex: number;         // Index of last completed tool
  streamIndex: number;           // Last streamed chunk index
  createdAt: Date;
  updatedAt: Date;
}
```

### Open Questions

1. **Idempotency**: How do we handle tools with side effects (file writes, API calls) on retry? Should tools declare idempotency?

2. **Checkpoint storage**: Database (simple, consistent) vs KV store (faster, but eventual consistency)?

3. **Stream reconstruction**: On resume, should we replay previous chunks or just continue from where we left off?

4. **Timeout handling**: How long should checkpoints persist? What happens to orphaned checkpoints?

5. **Sandbox drift**: If sandbox state changes between retry attempts (external changes), how do we detect/handle conflicts?
