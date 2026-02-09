# Sandbox lifecycle

This document describes how sandbox lifecycle management works, including automatic hibernation, hard-timeout rollover, and manual restore.

## Timeouts

| Constant | Test | Production | Purpose |
|---|---|---|---|
| `DEFAULT_SANDBOX_TIMEOUT_MS` | 3 min | 5 hours | Hard VM expiry from Vercel |
| `SANDBOX_INACTIVITY_TIMEOUT_MS` | 1 min | 30 min | Inactivity window before hibernate |
| `SANDBOX_HARD_TIMEOUT_GUARD_MS` | 30s | 2 min | Buffer before hard expiry to trigger rollover |

Configured in `lib/sandbox/config.ts`.

## State machine

```
                        ┌──────────────┐
                        │ provisioning │
                        └──────┬───────┘
                               │ sandbox created
                               │ kick workflow W1
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
            │       │ kick workflow W(n+1)          (restore)
            └───────┘

 Near hard timeout (last G seconds) + user active?
            │
            ▼
    ┌───────────────┐
    │  rolling over  │
    │ snapshot() +   │──▶ back to active (new sandbox generation)
    │ restore()      │    kick workflow W(n+1)
    └───────────────┘
```

Where **I** = inactivity timeout, **H** = hard timeout, **G** = guard window.

## How workflows work

Each lifecycle event calls `kickSandboxLifecycleWorkflow()`, which calls `start(sandboxLifecycleWorkflow, ...)` to create a **new, independent durable workflow run** via the Vercel Workflow DevKit.

A single workflow run does:

1. Read session from DB
2. Compute `wakeAtMs = min(hibernateAfter, expiresAt - G)`
3. `sleep(wakeAtMs)` — durable sleep that survives deploys and serverless cold starts
4. Wake up and evaluate:
   - **User inactive** (`now >= hibernateAfter`) → **hibernate** (snapshot + stop)
   - **Near hard timeout** (`now >= expiresAt - G`) AND user active → **rollover** (snapshot + restore into fresh sandbox)
   - **Neither** → **skip** ("not-due-yet"), then retry once with fresh DB state
5. Exit

### Multiple concurrent workflows

Each kick creates a new run. Multiple runs can coexist for the same session. This is safe because:

- They all sleep until different wake times based on when they were kicked
- The first one to act (hibernate or rollover) clears runtime state
- Subsequent runs wake up, see no operable sandbox, and exit immediately
- Workflow runs are cheap — sleep is free

### Example timeline

```
T=0:00  Create sandbox → kick W1 (sleeps until T=1:00)

T=0:30  User sends message
        chat-started: refresh activity, hibernateAfter=1:30
        kick W2 (sleeps until T=1:30)

T=0:45  Chat finishes
        chat-finished: refresh activity, hibernateAfter=1:45
        kick W3 (sleeps until T=1:45)

T=1:00  W1 wakes → now < hibernateAfter(1:45) → SKIP
        retry: re-compute, sleep until 1:45

T=1:30  W2 wakes → now < hibernateAfter(1:45) → SKIP
        retry: re-compute, sleep until 1:45

T=1:45  W1, W2, W3 all wake
        First to evaluate: now >= hibernateAfter → HIBERNATE
        Others: see no operable sandbox → SKIP and exit
```

## Events that kick workflows

| Event | Reason | Source |
|---|---|---|
| Sandbox created | `sandbox-created` | `POST /api/sandbox` |
| Cloud sandbox ready (hybrid handoff) | `cloud-ready` | `onCloudSandboxReady` hook |
| Chat request received | `chat-started` | `POST /api/chat` (before streaming) |
| Chat response finished | `chat-finished` | `POST /api/chat` (`onFinish`) |
| Manual extend | `timeout-extended` | `POST /api/sandbox/extend` |
| Manual snapshot | `manual-snapshot` | `POST /api/sandbox/snapshot` |
| Snapshot restore | `snapshot-restored` | `PUT /api/sandbox/snapshot` |
| Status poll finds overdue sandbox | `status-check-overdue` | `GET /api/sandbox/status` |

## Activity tracking

`lastActivityAt` and `hibernateAfter` are refreshed:

- **At chat start** — prevents hibernation during long-running AI responses
- **At chat finish** — resets the inactivity window after each interaction
- **On sandbox create/extend/restore** — resets after manual lifecycle events

These are **not** refreshed on:
- **Reconnect probes** — otherwise every page load defeats the inactivity timer
- **Status polling** — read-only DB check, no side effects on activity

## Safety nets

1. **Status endpoint** (`GET /api/sandbox/status`) — polled every 15s by the client. If the sandbox is overdue for hibernation but the lifecycle hasn't acted, kicks a workflow via `after()`.
2. **Workflow retry** — if evaluation returns "not-due-yet" (activity happened during sleep), re-computes wake time and tries once more before exiting.
3. **Inline fallback** — if `start(workflow)` fails (workflow SDK unavailable in dev), runs `evaluateSandboxLifecycle()` synchronously as a fallback.

## Client-side UI sync

The client polls `GET /api/sandbox/status` every 15s to get the server's view of lifecycle state. The UI derives sandbox status from:

- **Server lifecycle state** (`active`, `hibernated`, `hibernating`, etc.) — primary source
- **Local sandbox info** (`createdAt + timeout`) — secondary, for countdown display

The status chip shows:
- **Active** — server says active AND local timeout hasn't expired
- **Paused** — server says hibernated, or no runtime sandbox state with a snapshot available
- **No sandbox** — no runtime state and no snapshot

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
