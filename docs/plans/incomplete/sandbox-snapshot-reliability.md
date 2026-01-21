# Plan: Sandbox Snapshot Reliability

## Problem

The current timeout/snapshot architecture relies on the client being active:

1. Sandbox created with `timeout + buffer` (e.g., 5 min + 30 sec)
2. At 5 min, client detects timeout and sends DELETE or snapshot request
3. **If client is inactive** (tab closed, computer asleep, navigated away), no request is sent
4. Sandbox dies at SDK timeout with no snapshot created

## Approaches

Two possible solutions are outlined below. They can be implemented independently or combined.

---

## Approach A: Snapshot on Every Response + Auto-Extend

**Snapshot after every assistant response** and **auto-extend timeout on message received**.

This eliminates reliance on client-side timeout handling and ensures we always have a recent snapshot.

### Implementation

#### 1. Auto-extend timeout on message received

**File:** `apps/web/app/api/chat/route.ts` (after sandbox connection, ~line 70)

```typescript
// Auto-extend timeout if less than 5 minutes remaining
// This keeps the sandbox alive while user is actively chatting
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const EXTEND_BY_MS = 10 * 60 * 1000;

if (sandbox.extendTimeout && sandbox.expiresAt) {
  const timeRemaining = sandbox.expiresAt - Date.now();
  if (timeRemaining < FIVE_MINUTES_MS) {
    try {
      await sandbox.extendTimeout(EXTEND_BY_MS);
    } catch (error) {
      console.error("Failed to extend sandbox timeout:", error);
    }
  }
}
```

#### 2. Snapshot after every assistant response

**File:** `apps/web/app/api/chat/route.ts` (in `onFinish` callback)

Replace the current sandbox state persistence logic:

```typescript
// Snapshot sandbox after response (for cloud sandboxes)
// This ensures we always have a recent snapshot even if client disconnects
// Note: snapshot() automatically stops the sandbox; next message restores from snapshot
if (sandbox.snapshot) {
  try {
    const result = await sandbox.snapshot();
    const currentState = sandbox.getState?.() as SandboxState | undefined;

    // Determine the new state type based on current sandbox
    const newState: SandboxState =
      currentState?.type === "hybrid"
        ? { type: "hybrid", snapshotId: result.snapshotId }
        : { type: "vercel", snapshotId: result.snapshotId };

    await updateTask(taskId, {
      snapshotUrl: result.snapshotId,
      snapshotCreatedAt: new Date(),
      sandboxState: newState,
    });
  } catch (error) {
    console.error("Failed to snapshot sandbox:", error);
    // Fall back to persisting current state if snapshot fails
    if (sandbox.getState) {
      try {
        const currentState = sandbox.getState() as SandboxState;
        await updateTask(taskId, { sandboxState: currentState });
      } catch (fallbackError) {
        console.error("Failed to persist sandbox state (fallback):", fallbackError);
      }
    }
  }
} else if (sandbox.getState) {
  // Non-cloud sandbox (e.g., JustBash in pre-handoff) - persist state
  // ... existing pre-handoff state handling ...
}
```

### Flow After Implementation

```
User sends message
  → Connect to sandbox (restore from snapshot if needed)
  → Check timeout, extend if < 5 min remaining
  → Process message via agent
  → Assistant responds
  → onFinish: snapshot sandbox (stops it, saves snapshotId)
  → Response returned to user

Next message:
  → Connect to sandbox (restores from snapshotId via connectHybrid/connectVercel)
  → ... repeat ...
```

### What This Simplifies

Can potentially remove:

- `beforeStop` hook snapshotting logic
- `onTimeout` hook
- Client-side timeout tracking for snapshots
- `TIMEOUT_BUFFER_MS` complexity (active users auto-extend, inactive users have snapshot)
- Race conditions between timeout and snapshot
- Possibly the separate POST `/api/sandbox/snapshot` endpoint (or keep for manual use)

### Considerations

1. **Performance:** Each message creates a new VM from snapshot. Vercel snapshot restore should be fast, but monitor latency.

2. **Cost:** More snapshots created. Check Vercel pricing for snapshot storage.

3. **Snapshot expiration:** Native Vercel snapshots expire after 7 days. Long-idle tasks will lose their snapshot.

4. **Pre-handoff hybrid:** JustBash sandboxes don't support snapshot. Keep existing state persistence for pre-handoff phase.

### Testing Checklist

- [ ] Auto-extend triggers when < 5 min remaining
- [ ] Snapshot created after each assistant response
- [ ] Next message successfully restores from snapshot
- [ ] Pre-handoff hybrid (JustBash) still works without snapshot
- [ ] Fallback state persistence works when snapshot fails
- [ ] Client disconnect mid-conversation → snapshot from last response exists

---

## Approach B: Cron-Based Snapshot Before Timeout

Run a scheduled job to snapshot sandboxes approaching their timeout.

### The Math

To guarantee catching **every** sandbox before timeout:

```
timeout = T (e.g., 30 min)
cron_interval = C (e.g., 15 min)
threshold = S (snapshot if < S minutes remaining)

Rule: S > C (threshold must exceed cron interval)
```

**Why?** A sandbox created right after a cron run needs to survive until the next cron run AND still be within threshold.

### Example Configurations

| Timeout | Cron Interval | Threshold | Guarantee |
|---------|---------------|-----------|-----------|
| 5 min   | 2 min         | 3 min     | ✓ Catches all, but many cron runs |
| 30 min  | 15 min        | 20 min    | ✓ Reasonable balance |
| 60 min  | 15 min        | 20 min    | ✓ Fewer snapshots per sandbox |

### Recommendation

Increase default timeout significantly and use reasonable cron interval:

```typescript
DEFAULT_TIMEOUT = 30 * 60 * 1000;     // 30 minutes
CRON_INTERVAL = 15 * 60 * 1000;       // 15 minutes
SNAPSHOT_THRESHOLD = 20 * 60 * 1000;  // 20 minutes remaining
```

### Implementation

#### 1. Increase default timeout

**File:** `apps/web/app/api/sandbox/route.ts`

```typescript
const DEFAULT_TIMEOUT = 30 * 60 * 1000; // 30 minutes (was 5 minutes)
```

#### 2. Create cron endpoint

**File:** `apps/web/app/api/cron/snapshot-expiring-sandboxes/route.ts`

```typescript
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { connectSandbox } from "@open-harness/sandbox";
import { sql } from "drizzle-orm";

const SNAPSHOT_THRESHOLD_MS = 20 * 60 * 1000; // 20 minutes

export async function GET(req: Request) {
  // Verify cron secret (Vercel cron or similar)
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Find tasks with sandboxes expiring within threshold
  // This requires storing expiresAt in the task or calculating from sandboxState
  const expiringTasks = await db
    .select()
    .from(tasks)
    .where(
      sql`sandbox_state IS NOT NULL
          AND sandbox_state->>'sandboxId' IS NOT NULL
          AND sandbox_state->>'expiresAt' IS NOT NULL
          AND (sandbox_state->>'expiresAt')::bigint - ${Date.now()} < ${SNAPSHOT_THRESHOLD_MS}`
    );

  const results = [];

  for (const task of expiringTasks) {
    try {
      const sandbox = await connectSandbox(task.sandboxState);

      if (sandbox.snapshot) {
        const result = await sandbox.snapshot();
        await updateTask(task.id, {
          snapshotUrl: result.snapshotId,
          snapshotCreatedAt: new Date(),
          sandboxState: {
            type: task.sandboxState.type,
            snapshotId: result.snapshotId
          },
        });
        results.push({ taskId: task.id, status: "snapshotted" });
      }
    } catch (error) {
      results.push({
        taskId: task.id,
        status: "error",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return Response.json({ processed: results.length, results });
}
```

#### 3. Configure cron schedule

**File:** `vercel.json`

```json
{
  "crons": [
    {
      "path": "/api/cron/snapshot-expiring-sandboxes",
      "schedule": "*/15 * * * *"
    }
  ]
}
```

#### 4. Store expiresAt in task

Need to persist `expiresAt` when sandbox is created/extended so cron can query it.

**File:** `apps/web/app/api/sandbox/route.ts` (on create)

```typescript
await updateTask(taskId, {
  sandboxState: sandbox.getState(),
  sandboxExpiresAt: sandbox.expiresAt ? new Date(sandbox.expiresAt) : null,
});
```

### Considerations

1. **Database query:** Need efficient index on `sandboxExpiresAt` for cron query
2. **Concurrent snapshots:** Cron could snapshot while user is mid-conversation
3. **expiresAt tracking:** Must keep `sandboxExpiresAt` updated when timeout is extended
4. **Error handling:** If cron fails, sandbox may expire without snapshot

### Testing Checklist

- [ ] Cron runs every 15 minutes
- [ ] Query correctly finds expiring sandboxes
- [ ] Snapshot created for sandboxes within threshold
- [ ] expiresAt updated when timeout extended
- [ ] Cron handles errors gracefully (doesn't crash on one failure)

---

## Comparison

| Aspect | Approach A (On-Response) | Approach B (Cron) |
|--------|--------------------------|-------------------|
| Snapshots per session | Many (after each message) | 1 (near end of life) |
| Sandbox stays alive | No, stops after each response | Yes, full duration |
| Work loss risk | None | Work since last response |
| Infrastructure | None | Cron job |
| Latency per message | Snapshot overhead | None |
| Complexity | Simpler | More moving parts |

## Recommendation

**Start with Approach A** (snapshot on every response) for simplicity and strongest guarantees. Monitor performance and cost. If snapshot restore latency or cost becomes problematic, consider switching to or combining with Approach B.

**Hybrid option:** Use Approach A for the guarantee, but increase timeout significantly (30+ min) so snapshots happen less frequently during active use (auto-extend keeps sandbox alive).
