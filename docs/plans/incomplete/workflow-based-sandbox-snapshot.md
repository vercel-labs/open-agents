# Workflow-Based Sandbox Lifecycle

## Product Goal

Sandbox lifecycle should feel invisible in the web app:

1. User starts a new session and gets a usable sandbox quickly.
2. User keeps working without manual timeout babysitting.
3. If user disappears, state is preserved automatically.
4. When user returns, work resumes with minimal latency.
5. When user is done, they create a PR and archive cleanly.

Snapshotting is a core mechanism, but the system should optimize the full lifecycle (latency, reliability, and cost), not only timeout rescue.

## Current Gaps

1. Timeout/snapshot behavior still depends heavily on a live client.
2. Timeout metadata is mostly implicit in `sandboxState` JSON.
3. Lifecycle actions are route-local (`/api/sandbox`, `/api/sandbox/extend`, `/api/chat`) instead of centrally orchestrated.
4. UX still surfaces timeout pressure (extend warning) instead of making lifecycle mostly automatic.

## Design Principles

1. Server is source of truth for lifecycle; client is advisory only.
2. Keep hot sandboxes alive while there is recent activity.
3. Snapshot on transitions (idle/stop/failure windows), not every response.
4. Creating a snapshot is also a shutdown event: once snapshotted, the running sandbox is no longer reachable until restore/reconnect.
5. Use durable orchestration with idempotent steps and supersession tokens.
6. Prefer explicit lifecycle columns over querying inside JSON state blobs.

## Target Lifecycle Model

### Session States

1. `provisioning`: sandbox being created.
2. `active`: sandbox running and eligible for auto-extend.
3. `hibernating`: snapshot in progress.
4. `hibernated`: no active sandbox, snapshot available.
5. `restoring`: sandbox being restored from snapshot.
6. `archived`: session done (PR created or explicitly stopped).
7. `failed`: terminal failure requiring user action.

### Core Timestamps

1. `lastActivityAt`: updated on every successful chat turn.
2. `sandboxExpiresAt`: copied from sandbox runtime (`expiresAt`) for fast checks.
3. `hibernateAfter`: inactivity deadline (for example, `lastActivityAt + 10m`).
4. `snapshotCreatedAt`: latest durable checkpoint timestamp.

## Orchestration Design (Workflow)

Use short-run, event-kicked workflows (not a single self-looping run).

### Inputs

1. `sessionId`
2. `lifecycleVersion` (incremented when a new lifecycle generation supersedes stale runs)
3. Optional `reason` (`created`, `extended`, `activity`, `manual-stop`, `retry`)

### Run Shape

1. `use step`: load session lifecycle row.
2. Exit if row version differs from workflow version.
3. Exit if `archived` or `failed`.
4. Compute next deadline (`min(sandboxExpiresAt - SNAPSHOT_GUARD_MS, hibernateAfter)`).
5. `sleep()` until that deadline.
6. `use step`: re-read row and decide one transition:
   - Snapshot + clear running sandbox if idle or near expiry (snapshot shuts down sandbox automatically).
   - Skip if already hibernated/archived by another actor.
7. Persist transition and exit.

### Kick Sources

1. Sandbox create / cloud-ready transition.
2. Chat activity completion (`onFinish`) that updates `lastActivityAt`.
3. Manual stop/snapshot operations.
4. Explicit timeout extension (if retained as fallback tooling).

### Idempotency and Concurrency

1. Every mutating step checks `lifecycleVersion` before write.
2. Snapshot step uses a lease/compare-and-set so only one worker snapshots.
3. Duplicate workflow starts are safe: stale runs self-terminate on version mismatch.

## Performance Strategy

1. Keep one running sandbox during active chat streaks.
2. Remove client-side auto-extend logic entirely.
3. Set long server timeout (`5 hours`) so timeout management is not user-visible during normal work.
4. Hibernate based on inactivity (`30 minutes`) or near-expiry guard window, not every message.
5. Restore lazily when next message arrives, then return to `active`.
6. (Optional) Prewarm on session-open if last state is hibernated and user likely to continue.

This avoids per-turn cold starts while still giving reliable persistence when users close tabs.

### Initial Policy Defaults

1. Inactivity hibernation target: `30 minutes` from last activity.
2. Creating a PR does not require a final snapshot checkpoint before archive.
3. Default sandbox runtime timeout: `5 hours`.
4. Client auto-extend: disabled.

### Hard Timeout Rollover (`5h` Edge Case)

When a sandbox approaches the hard timeout, lifecycle logic must not rely on user action:

1. Wake at `sandboxExpiresAt - HARD_TIMEOUT_GUARD_MS`.
2. If session is actively being used, run rollover:
   - Create snapshot (this shuts down the current sandbox).
   - Immediately restore into a new sandbox from that snapshot.
   - Persist new `sandboxState` + `sandboxExpiresAt`.
   - Keep lifecycle state as `active`.
   - Coordinate with chat in-flight state so rollover does not interrupt an active response stream.
3. If session is not actively being used, run normal hibernation:
   - Create snapshot (sandbox shuts down).
   - Persist hibernated state and wait for next message restore.
4. If rollover snapshot/restore fails, fail safe by preserving snapshot when possible and marking lifecycle for retry/error handling (never silently drop state).

## Required Data Model Changes

Add lifecycle-focused columns to `sessions` (names can vary):

1. `lifecycleState` (`provisioning|active|hibernating|hibernated|restoring|archived|failed`)
2. `lifecycleVersion` (integer, monotonic)
3. `lastActivityAt` (timestamp)
4. `sandboxExpiresAt` (timestamp)
5. `hibernateAfter` (timestamp)
6. `lifecycleRunId` (text, optional for observability)
7. `lifecycleError` (text, nullable)

Keep existing:

1. `sandboxState` for connect/restore details.
2. `snapshotUrl` + `snapshotCreatedAt` for durable checkpoint reference.

## Integration Points in Current Code

1. `apps/web/app/api/sandbox/route.ts`
   - After sandbox creation and state persistence, initialize lifecycle fields and start workflow.
   - For hybrid, also trigger lifecycle kick from `onCloudSandboxReady` when cloud sandbox becomes active.

2. `apps/web/app/api/chat/route.ts`
   - On successful assistant completion, update `lastActivityAt`.
   - Persist latest `sandboxState` and `sandboxExpiresAt`.
   - Fire a lightweight lifecycle "activity kick" (idempotent one-shot workflow).

3. `apps/web/app/api/sandbox/extend/route.ts`
   - Keep only as explicit/manual fallback (not a primary UX path).
   - After extend, persist `sandboxExpiresAt`, increment lifecycle version when needed, and kick workflow.

4. `apps/web/app/api/sandbox/snapshot/route.ts`
   - Reuse shared snapshot transition logic so manual snapshot and workflow snapshot follow the same state machine.

## Rollout Plan

### Phase 1: Reliability Baseline

1. Add lifecycle columns and write-path updates.
2. Start one-shot workflow runs on sandbox create/ready/activity/extend.
3. Implement "snapshot before expiry" guard with supersession checks.

Success criteria:
1. No state loss when tab is closed before timeout.
2. Duplicate workflow runs cause no duplicate snapshots or broken states.

### Phase 2: Inactivity Hibernation

1. Drive hibernation from `lastActivityAt` + policy.
2. Remove timeout-driven client UX (including auto-extend behavior).
3. Ensure first message after idle transparently restores sandbox.

Success criteria:
1. Users can leave and return without manual recovery actions.
2. Most sessions avoid explicit "extend timeout" interaction.

### Phase 3: Seamless Performance

1. Tune inactivity thresholds and guard windows from metrics.
2. Add optional prewarm for likely-return sessions.
3. Remove remaining client-side lifecycle coupling where safe.

Success criteria:
1. Fast first action in new sessions.
2. Low frequency of visible lifecycle interruptions.
3. Stable snapshot/restore latency and failure rates.

## Metrics and SLOs

Track at minimum:

1. `time_to_first_command_ms` (new session perceived startup)
2. `resume_latency_ms` (hibernated -> active on next message)
3. `snapshot_success_rate`
4. `restore_success_rate`
5. `lifecycle_interruptions_per_session` (user-visible timeout/restore friction)
6. `idle_runtime_minutes_saved` (cost efficiency)

## Decisions

1. Workflow shape: short-run event-kicked workflows (not self-looping).
2. Client auto-extend: remove (no long-term redundancy path).
3. Inactivity threshold: `30 minutes`.
4. Default sandbox timeout: `5 hours`.
5. PR archive flow: no mandatory final snapshot checkpoint.
6. Hard-timeout behavior: pre-expiry rollover for active sessions (snapshot -> immediate restore), otherwise snapshot -> hibernate.
