# Hybrid Sandbox Web Integration Research

This document explores how the hybrid sandbox switch-over mechanism integrates with the web application.

## Executive Summary

The hybrid sandbox eliminates the 10-12 second wait when starting a task. By starting with a lightweight JustBash sandbox (~110ms) while Vercel boots in the background, users see agent activity immediately. The handoff is transparent - writes are tracked and replayed when Vercel becomes available.

---

## Current Architecture

### Existing Flow (with wait)

```
POST /api/sandbox (apps/web/app/api/sandbox/route.ts:94)
    └── connectVercelSandbox() → blocks for ~10-12s
    └── Returns { sandboxId, createdAt, timeout }

POST /api/chat (apps/web/app/api/chat/route.ts:75)
    └── connectVercelSandbox({ sandboxId }) → reconnects
    └── webAgent.stream({ sandbox }) → agent runs
```

**Current pain point**: Line 94 in `/api/sandbox/route.ts` blocks for ~10-12 seconds.

### Existing Prototype

A working `HybridSandbox` class exists in `apps/web/hybrid-sandbox-handoff-test.ts`:
- Downloads repo tarball (~100ms)
- Creates JustBash with tarball files
- Starts Vercel in background (non-blocking)
- Tracks writes in `pendingOperations[]`
- Auto-handoff when git/npm/curl detected
- Replays writes during `performHandoff()`

---

## Integration Challenge

The main challenge is **statefulness across requests**:

| Current | Hybrid |
|---------|--------|
| Sandbox created in `/api/sandbox` | JustBash created immediately |
| Sandbox ID stored in DB | No ID for JustBash, Vercel ID comes later |
| `/api/chat` reconnects by ID | Need to track hybrid state somehow |
| Stateless API | Need per-session state |

**Key decision**: Where does the HybridSandbox instance live?

---

## Integration Options

### Option 1: Server-Side Hybrid Factory

Create HybridSandbox in `/api/sandbox`, but return immediately:

```typescript
// apps/web/app/api/sandbox/route.ts
export async function POST(req: Request) {
  // Start tarball download + JustBash creation (fast path)
  const { files } = await downloadAndExtractTarball(repoUrl, branch, token);
  const justBash = await createJustBashSandbox({
    workingDirectory: "/vercel/sandbox",
    files,
    mode: "memory",
  });

  // Start Vercel in background (non-blocking)
  const vercelPromise = connectVercelSandbox({ source: { url: repoUrl, branch } });

  // Store hybrid state in server-side map keyed by task ID
  hybridSandboxes.set(taskId, { justBash, vercelPromise, pendingOps: [] });

  // Return immediately (~100ms)
  return Response.json({
    sandboxId: `hybrid:${taskId}`,
    type: "hybrid",
    ready: true,
  });
}
```

Then in `/api/chat`:

```typescript
// apps/web/app/api/chat/route.ts
const hybrid = hybridSandboxes.get(taskId);
if (!hybrid) {
  // Fallback: create fresh hybrid or reconnect to Vercel
}

// Agent uses hybrid sandbox (transparent proxy)
const result = await webAgent.stream({
  sandbox: hybrid,  // HybridSandbox implements Sandbox
  ...
});
```

**Challenge**: Server-side state between requests. Options:
- In-memory Map (lost on restart, doesn't scale)
- Redis (adds complexity)
- Pass state in request (not practical for sandbox instances)

### Option 2: Chat-Route Hybrid Creation

Create HybridSandbox when chat starts, not in `/api/sandbox`:

```typescript
// apps/web/app/api/chat/route.ts
let sandbox: Sandbox;

if (!task.sandboxId) {
  // First message: create hybrid
  const hybrid = await createHybridSandbox({
    repoUrl: task.repoUrl,
    branch: task.branch,
    token: githubToken,
  });
  sandbox = hybrid;

  // When Vercel ready, save its ID
  hybrid.onVercelReady = (vercelId) => {
    updateTask(taskId, { sandboxId: vercelId });
  };
} else {
  // Subsequent messages: reconnect to Vercel
  sandbox = await connectVercelSandbox({ sandboxId: task.sandboxId });
}
```

**Pros**: Simpler state management, hybrid scoped to single chat session
**Cons**: First message still has to wait for tarball (~100ms)

### Option 3: Streaming Start with SSE

Frontend initiates hybrid startup, receives progress via SSE:

```
Frontend                      Backend
   │                             │
   ├──POST /api/sandbox/start────►│ Start JustBash + Vercel
   │                             │
   │◄──SSE: justbash_ready (100ms)│ JustBash ready, agent can start
   │                             │
   │    [User sends message]      │
   │                             │
   │◄──SSE: vercel_ready (10s)────│ Vercel ready, handoff possible
```

**Pros**: Best UX, immediate feedback
**Cons**: Complex implementation, SSE management

---

## Recommended Approach: Option 2 (Chat-Route Hybrid)

Simplest integration with existing architecture:

1. **No changes to `/api/sandbox`** - Keep existing Vercel-only creation
2. **Modify `/api/chat`** to create HybridSandbox on first message
3. **HybridSandbox lives in memory** for duration of streaming response
4. **Save Vercel ID to DB** when handoff completes
5. **Subsequent messages** reconnect to Vercel directly

### Flow

```
First message:
  /api/chat → task.sandboxId is null
           → createHybridSandbox() (~100ms)
           → Agent starts on JustBash
           → Vercel boots in background
           → When ready, updateTask(sandboxId)
           → Handoff on git/npm command

Subsequent messages:
  /api/chat → task.sandboxId exists
           → connectVercelSandbox(sandboxId)
           → Agent continues on Vercel
```

---

## Files to Modify

| File | Change |
|------|--------|
| `packages/sandbox/hybrid.ts` | New file: HybridSandbox class |
| `packages/sandbox/index.ts` | Export HybridSandbox |
| `apps/web/app/api/chat/route.ts` | Use HybridSandbox on first message |
| `apps/web/lib/tarball.ts` | New file: GitHub tarball utilities |
| `apps/web/components/task-context.tsx` | (Optional) Show hybrid status |

---

## HybridSandbox Class (from prototype)

The prototype at `apps/web/hybrid-sandbox-handoff-test.ts:161-399` already has:

- State machine: `"justbash" | "switching" | "vercel"`
- Write tracking: `pendingOperations: PendingOperation[]`
- Auto-detection: `commandRequiresVercel()` checks for git/npm/curl
- Handoff: `performHandoff()` replays writes
- Path alignment: Both use `/vercel/sandbox`

**Action**: Extract and refine into `packages/sandbox/hybrid.ts`

---

## Edge Cases

### 1. Vercel Fails to Start
```typescript
// In HybridSandbox constructor
this.vercelPromise.catch((error) => {
  this.vercelFailed = true;
  console.error("Vercel failed:", error);
});

// In exec(), if Vercel required but failed:
if (this.requiresVercel(command) && this.vercelFailed) {
  return { success: false, stderr: "Cloud sandbox unavailable" };
}
```

### 2. Large Repos
```typescript
// In tarball download
const MAX_TARBALL_SIZE = 50 * 1024 * 1024; // 50MB
if (response.headers.get("content-length") > MAX_TARBALL_SIZE) {
  // Skip JustBash, wait for Vercel
  return connectVercelSandbox({ source: { url: repoUrl } });
}
```

### 3. Binary Files
Tarball extraction only handles text files. Binary files (images, etc.) won't be readable in JustBash. Agent should handle gracefully:
```typescript
async readFile(path: string, encoding: "utf-8"): Promise<string> {
  try {
    return await this.current.readFile(path, encoding);
  } catch {
    // Might be binary file not in tarball
    if (this.isVercelReady()) {
      await this.performHandoff();
      return this.current.readFile(path, encoding);
    }
    throw new Error(`File not available yet: ${path}`);
  }
}
```

---

## Open Questions

1. **Should sandbox creation wait for JustBash?**
   - Option A: Return immediately from `/api/sandbox`, create JustBash in `/api/chat`
   - Option B: `/api/sandbox` creates JustBash, returns fast (~100ms)

2. **How to handle session timeout?**
   - JustBash is ephemeral, no reconnect
   - If Vercel not ready when session ends, state is lost
   - Probably fine: 10s is usually enough

3. **Should we show hybrid status in UI?**
   - Simple: Just show "Agent working..."
   - Detailed: "Agent working (cloud loading...)" → "Cloud ready"

---

## Stateless JustBash Exploration

### The Stateless Challenge

The current recommended approach (Option 2) requires holding a JustBash instance in memory during the streaming response. This works because a single chat request typically:
- Creates hybrid sandbox
- Agent runs multiple tool calls
- Vercel becomes ready (~10s)
- Handoff happens
- Response completes

But what if we wanted **fully stateless** JustBash usage?

### Potential Stateless Approaches

#### Approach A: Recreate JustBash Per Request

Each `/api/chat` call creates a fresh JustBash from tarball:

```typescript
// Every request downloads tarball and creates JustBash fresh
const { files } = await downloadAndExtractTarball(repoUrl, branch);
const justBash = await createJustBashSandbox({ files });
```

**Problem**: Writes from previous requests are lost. If agent wrote to a file, next request won't see it.

**Mitigation**: Store writes in database:
```typescript
// After each write, persist to DB
pendingWrites.push({ path, content });
await updateTask(taskId, { pendingWrites });

// On next request, replay writes to fresh JustBash
const writes = task.pendingWrites ?? [];
for (const w of writes) {
  await justBash.writeFile(w.path, w.content, "utf-8");
}
```

#### Approach B: Serialize JustBash State

Export and import JustBash filesystem state:

```typescript
// After request, serialize state
const state = justBash.serialize(); // { files: Record<string, string> }
await updateTask(taskId, { justBashState: state });

// On next request, restore state
const justBash = await createJustBashSandbox({
  files: task.justBashState?.files ?? initialFiles,
});
```

**Problem**: JustBash doesn't have serialize/deserialize methods. Would need to add.

#### Approach C: Keep JustBash Stateless, Only Use for Reads

Accept that JustBash is read-only until Vercel is ready:

```typescript
async writeFile(path: string, content: string): Promise<void> {
  if (this.state === "justbash") {
    // Queue write for Vercel, don't write to JustBash
    this.pendingWrites.push({ path, content });
    // Return success but file isn't actually written yet
    return;
  }
  return this.vercel.writeFile(path, content);
}
```

**Problem**: Agent can't read back its own writes until Vercel is ready.

### Recommendation for Stateless

For truly stateless operation:
1. **Accept the ~100ms tarball overhead** per request
2. **Store pending writes in database** between requests
3. **Replay writes** when recreating JustBash
4. **Switch to Vercel ASAP** and stop using JustBash

This keeps the server stateless while still providing fast initial reads. Writes are queued and replayed.
