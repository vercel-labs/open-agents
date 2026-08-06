# Sandbox lifecycle

This document describes how sandbox lifecycle management works, including automatic hibernation and manual restore.

## Timeouts

| Constant | Test | Production | Purpose |
|---|---|---|---|
| `DEFAULT_SANDBOX_TIMEOUT_MS` | 3 min | 5 hours standard / 40 minutes hobby | Hard VM expiry from Vercel |
| `SANDBOX_INACTIVITY_TIMEOUT_MS` | 30 min | 30 min | Inactivity window before hibernate |

Configured in `lib/sandbox/config.ts`. Set `OPEN_AGENTS_RESOURCE_PROFILE=hobby` to opt into the hobby profile; unset keeps standard behavior.

## State machine

```
                        ┌──────────────┐
                        │ provisioning │
                        └──────┬───────┘
                               │ sandbox created
                               │ start workflow run
                               ▼
                   ┌──────────────────────┐
            ┌─────▶│       active          │◀──────────────────┐
            │      │                        │                    │
            │      │ lastActivityAt = now   │                    │
            │      │ hibernateAfter = now+I │                    │
            │      │ sandboxExpiresAt = T+H │                    │
            │      └───┬──────────┬─────────┘                    │
            │          │          │                               │
            │    user sends    no activity                        │
            │    a message     for I minutes                      │
            │          │          │                               │
            │          ▼          ▼                               │
            │  ┌──────────┐  ┌──────────────┐    ┌────────────┐  │
            │  │chat route│  │  hibernating  │───▶│ hibernated │  │
            │  │refreshes │  │  snapshot()   │    │ (paused)   │──┘
            │  │activity  │  │  stops sandbox│    └────────────┘
            │  └──────────┘  └──────────────┘     user clicks
            │       │                              "Resume"
            │       │ workflow continues           (restore)
            └───────┘
```

Where **I** = inactivity timeout, **H** = hard timeout.

When the hard timeout is reached while the sandbox is still active, it hibernates the same way as inactivity - snapshot and stop. The user can manually resume if needed. This is simpler than automatic rollover and sufficient because the standard hard timeout (5 hours) is long enough that inactivity hibernation will almost always trigger first.

## How workflows work

Each session keeps at most one durable workflow run. `kickSandboxLifecycleWorkflow()` starts the workflow only when no run is active. The workflow then claims a lease token in `sessions.lifecycleRunId` and checks it before each sleep so older runs exit when replaced.

A workflow run does:

1. Read session from DB and verify the lease
2. Compute `wakeAtMs = min(hibernateAfter, sandboxExpiresAt - buffer)`
3. `sleep(wakeAtMs)` - durable sleep that survives deploys and serverless cold starts
4. Wake up and evaluate:
   - **User inactive** or **hard timeout reached** → **hibernate** (snapshot + stop)
   - **Still active** → **skip** ("not-due-yet") and loop with fresh DB state
5. Exit and clear `lifecycleRunId` when hibernated or no longer operable

### Simple flow

- Start sandbox → start one workflow run
- Workflow sleeps until the next due time
- On wake, it either sleeps again or snapshots and stops
- The workflow only updates its sleep after it wakes, not on every message

### Scenarios

Example 1: user keeps sending messages

- T=0:00 sandbox starts, workflow sleeps until T=0:30
- T=0:10 message, `hibernateAfter = 0:40`
- T=0:30 workflow wakes, sees not due, sleeps until T=0:40
- T=0:25 message, `hibernateAfter = 0:55`
- T=0:40 workflow wakes, sees not due, sleeps until T=0:55

Example 2: user stops after a message

- T=0:00 sandbox starts, workflow sleeps until T=0:30
- T=0:10 message, `hibernateAfter = 0:40`
- T=0:30 workflow wakes, sees not due, sleeps until T=0:40
- T=0:40 workflow wakes, sees due, snapshots and stops

### Example timeline

```
T=0:00  Create sandbox → start W1 (sleeps until T=1:00)

T=0:30  User sends message
        refresh activity, hibernateAfter=1:30

T=0:45  Chat finishes
        refresh activity, hibernateAfter=1:45

T=1:00  W1 wakes → now < hibernateAfter(1:45) → SKIP
        re-compute, sleep until 1:45

T=1:45  W1 wakes
        now >= hibernateAfter → HIBERNATE
```

## Events that start workflows

| Event | Reason | Source |
|---|---|---|
| Sandbox created | `sandbox-created` | `POST /api/sandbox` |
| Manual extend | `timeout-extended` | `POST /api/sandbox/extend` |
| Snapshot restore | `snapshot-restored` | `PUT /api/sandbox/snapshot` |
| Status poll finds overdue sandbox | `status-check-overdue` | `GET /api/sandbox/status` |

## Activity tracking

`lastActivityAt` and `hibernateAfter` are refreshed:

- **At chat start** - prevents hibernation during long-running AI responses
- **At chat finish** - resets the inactivity window after each interaction
- **On sandbox create/extend/restore** - resets after manual lifecycle events
- **On textarea focus** - when the user focuses the chat input, a `POST /api/sandbox/activity` call resets the inactivity timer (throttled to once per 5 minutes) so composing a message doesn't trigger hibernation

Activity refreshes do not start new workflow runs. The active workflow observes the updated timestamps on its next wake.

These are **not** refreshed on:
- **Reconnect probes** - otherwise every page load defeats the inactivity timer
- **Status polling** - read-only DB check, no side effects on activity

## Safety nets

1. **Status endpoint** (`GET /api/sandbox/status`) - polled every 15s by the client. If the sandbox is overdue for hibernation but the lifecycle hasn't acted, it triggers a workflow kick. If a run is already active, the kick is ignored.
2. **Workflow retry** - if evaluation returns "not-due-yet" (activity happened during sleep), re-computes the next wake time and loops.
3. **Inline fallback** - if `start(workflow)` fails (workflow SDK unavailable in dev), runs `evaluateSandboxLifecycle()` synchronously as a fallback.
4. **Stale lease guard** - if a workflow lease is overdue by more than 2 minutes, clear the lease so a fresh run can start.

## Client-side UI sync

The client polls `GET /api/sandbox/status` every 15s to get the server's view of lifecycle state. The UI derives sandbox status from:

- **Server lifecycle state** (`active`, `hibernated`, `hibernating`, etc.) - primary source
- **Local sandbox info** (`createdAt + timeout`) - secondary, for countdown display

The status chip shows:
- **Active** - server says active AND local timeout hasn't expired
- **Paused** - server says hibernated, or no runtime sandbox state with a snapshot available
- **No sandbox** - no runtime state and no snapshot

A forced status sync fires immediately after each chat completion (`streaming → ready`) to minimize the gap between server state change and UI update.

## Key files

| File | Purpose |
|---|---|
| `lib/sandbox/lifecycle.ts` | Core evaluation logic, state builders, types |
| `lib/sandbox/lifecycle-kick.ts` | Workflow kick with inline fallback |
| `lib/sandbox/config.ts` | Timeout constants |
| `app/workflows/sandbox-lifecycle.ts` | Durable workflow (sleep + evaluate + retry) |
| `app/api/sandbox/status/route.ts` | Lightweight DB-backed status polling |
| `app/api/sandbox/reconnect/route.ts` | Sandbox connectivity probe |
| `app/api/chat/route.ts` | Activity refresh at start and finish |
