Summary: Migrate the sandbox stack from v1 ephemeral sandbox IDs plus snapshot-driven restores to v2 persistent named sandboxes. New sandboxes should use the deterministic name `session_${sessionId}`, persist that value in `sandboxState.sandboxId`, and keep it stable for the life of the session while using `stop()` (not `snapshot()`) for normal hibernation.

Context: Key findings from exploration -- existing patterns, relevant files, constraints

- The sandbox package is still on `@vercel/sandbox@^1.3.0` and the provider layer is built around ephemeral `sandboxId` reconnects and `snapshotId` restores.
  - `packages/sandbox/package.json`
  - `packages/sandbox/vercel/state.ts`
  - `packages/sandbox/vercel/connect.ts`
  - `packages/sandbox/vercel/sandbox.ts`
- Current state persistence stores runtime identity in `sandboxState.sandboxId` and clears it on stop/hibernate/archive. Hibernation is implemented by taking a snapshot, storing `snapshotUrl`, and replacing runtime state with `{ type: "vercel" }`.
  - `apps/web/lib/sandbox/lifecycle.ts`
  - `apps/web/lib/sandbox/archive-session.ts`
  - `apps/web/lib/sandbox/utils.ts`
  - `apps/web/app/api/sandbox/snapshot/route.ts`
- Many API routes treat “sandbox is usable” as “`sandboxState.sandboxId` is present”, and on unavailability they clear the sandbox state completely. That assumption breaks with persistent named sandboxes because the stable sandbox identity should remain even after `stop()`.
  - `apps/web/app/api/sandbox/reconnect/route.ts`
  - `apps/web/app/api/sandbox/status/route.ts`
  - `apps/web/app/api/sessions/[sessionId]/files/route.ts`
  - `apps/web/app/api/sessions/[sessionId]/files/content/route.ts`
  - `apps/web/app/api/sessions/[sessionId]/skills/route.ts`
  - `apps/web/app/api/sessions/[sessionId]/diff/route.ts`
- The DB schema already has a flexible `sandboxState` JSON column plus legacy snapshot fields. We can likely avoid a SQL migration if we keep using `sandboxState.sandboxId` as the persisted identifier and reserve `snapshotUrl` for legacy migration / optional backup only.
  - `apps/web/lib/db/schema.ts`
  - `apps/web/lib/db/sessions.ts`
- There is a high-risk direct REST optimization path that uses internal `@vercel/sandbox/dist/*` APIs and passes `sandboxId` everywhere. Since we are comfortable dropping it, the migration should explicitly remove/bypass this path and standardize on the documented SDK methods only.
  - `packages/sandbox/vercel/direct.ts`
  - `packages/sandbox/vercel/direct-operations.ts`

Approach: High-level design decision and why

- Use `session_${sessionId}` (underscore, not colon) as the canonical sandbox name.
- Keep the existing `sandboxState.sandboxId` field name for compatibility, but change its meaning from “ephemeral VM id” to “persistent sandbox name”.
- Split two concepts that are currently conflated:
  1. persistent sandbox identity (the named sandbox, stable across stops)
  2. active session/runtime availability (whether a VM session is currently running)
- For new v2 sandboxes:
  - create once with `name: session_${sessionId}`
  - persist that name in `sandboxState.sandboxId`
  - on inactivity/archive/manual pause, call `stop()` and keep the stable sandbox identity in DB
  - on resume, re-open by name and resume the stopped sandbox instead of creating a new sandbox from a snapshot
- For legacy v1 sandboxes already in the database:
  - if already archived/hibernated with `snapshotUrl`, resume into a new named sandbox `session_${sessionId}` on first restore
  - if currently active with an old ephemeral/backfilled id, keep working until the next pause/archive; at that point snapshot the legacy sandbox, persist the deterministic name, and restore into the new named sandbox on next resume
  - after successful migration from a legacy sandbox to the deterministic named sandbox, delete the obsolete legacy sandbox to avoid orphaned resources
- Keep the existing restore endpoint shape as the explicit “resume sandbox” entrypoint so the UI can stay mostly unchanged:
  - legacy sessions: restore from `snapshotUrl` into the named sandbox
  - v2 sessions: resume the named sandbox by name
- First implementation should prefer correctness over low-level optimization: remove the direct REST optimization entirely for this migration and route reconnect/resume/file operations through the documented SDK path.

Changes:
- `packages/sandbox/package.json` - upgrade `@vercel/sandbox` to the beta version.
- `packages/sandbox/vercel/state.ts` - redefine `sandboxId` semantics as persistent sandbox name; keep legacy snapshot support during migration.
- `packages/sandbox/vercel/sandbox.ts` - switch create/get/connect logic from `sandboxId` to `name`, return the stable name from `getState()`, add explicit resume support, and expose `delete()` for legacy cleanup if needed.
- `packages/sandbox/vercel/connect.ts` - connect/resume by name for v2 sandboxes, keep a legacy restore path for old snapshot-based sessions, and avoid name/ID confusion in state branching.
- `packages/sandbox/vercel/direct.ts` - remove or bypass the direct REST optimization so the provider always uses the documented SDK path.
- `packages/sandbox/vercel/direct-operations.ts` - delete or retire the unused low-level direct-operation helpers that depend on ephemeral ids.
- `apps/web/lib/sandbox/utils.ts` - replace the current “runtime state exists iff sandboxId exists” helpers with separate helpers for persistent identity vs active runtime session; stop clearing sandbox identity on ordinary stop/unavailability.
- `apps/web/lib/sandbox/lifecycle.ts` - for v2 sandboxes, hibernate with `stop()` and preserve `sandboxState`; keep legacy snapshot migration logic only for old sessions.
- `apps/web/lib/sandbox/archive-session.ts` - archive by stopping persistent named sandboxes without clearing their identity; use snapshot+restore only as a migration bridge for legacy sessions.
- `apps/web/app/api/sandbox/route.ts` - create named sandboxes with `session_${sessionId}`, update stop semantics, and persist the stable identifier immediately.
- `apps/web/app/api/sandbox/reconnect/route.ts` - stop clearing stable identity on stopped sandboxes; report stopped/expired status while keeping the named sandbox reference.
- `apps/web/app/api/sandbox/status/route.ts` - compute “active vs no active session” from lifecycle timing rather than presence/absence of `sandboxId`.
- `apps/web/app/api/sandbox/snapshot/route.ts` - repurpose restore into a generic resume endpoint: restore legacy snapshots into named sandboxes, resume v2 named sandboxes directly, and keep snapshot creation only if still needed for manual backup / legacy migration.
- `apps/web/app/api/sessions/[sessionId]/files/route.ts` - stop converting stopped persistent sandboxes into “missing sandbox” DB state.
- `apps/web/app/api/sessions/[sessionId]/files/content/route.ts` - same as above.
- `apps/web/app/api/sessions/[sessionId]/skills/route.ts` - same as above.
- `apps/web/app/api/sessions/[sessionId]/diff/route.ts` - same as above.
- `apps/web/lib/skills-cache.ts` - keep cache scoping keyed to the stable sandbox name; remove snapshot-based cache scope fallback once legacy migration is complete.
- `apps/web/lib/db/sessions.ts` - add helpers for deterministic sandbox naming / legacy detection and normalize session records without changing SQL schema.
- Tests to update alongside the implementation:
  - `packages/sandbox/vercel/sandbox.test.ts`
  - `packages/sandbox/vercel/direct.test.ts` (remove if the direct path is deleted, or replace with coverage that proves the SDK path is always used)
  - `apps/web/lib/sandbox/lifecycle-evaluate.test.ts`
  - `apps/web/lib/sandbox/archive-session.test.ts`
  - `apps/web/app/api/sandbox/route.test.ts`
  - `apps/web/app/api/sandbox/reconnect/route.test.ts`
  - `apps/web/app/api/sandbox/status/route.test.ts`
  - `apps/web/app/api/sandbox/snapshot/route.test.ts`
  - `apps/web/app/api/sessions/[sessionId]/files/content/route.test.ts`
  - `apps/web/app/api/sessions/[sessionId]/skills/route.test.ts`

Verification:
- Unit-test the provider layer to prove:
  - new sandboxes are created with `name: session_${sessionId}`
  - reconnect/resume uses name-based lookup
  - `getState()` always returns the stable sandbox name
  - v2 stop does not clear persistent identity
  - legacy snapshot restore migrates into the deterministic name
- API tests should prove:
  - create persists the stable name immediately
  - stop/archive leave the stable sandbox name in DB
  - reconnect/status no longer treat a stopped named sandbox as “missing state”
  - resume works for both migrated v2 sessions and legacy snapshot-backed sessions
  - file/skill/diff routes preserve identity when a sandbox is stopped/unavailable
- Run repository checks after implementation:
  - `bun run check`
  - `bun run typecheck`
  - `bun run test:isolated`
  - `bun run --cwd apps/web db:check`
- Edge cases to verify manually/in tests:
  - brand new session
  - paused/resumed v2 session
  - archived/unarchived v2 session
  - legacy archived session with only `snapshotUrl`
  - legacy active session that migrates on first pause/archive
  - failed resume when the named sandbox was deleted remotely
  - skills cache continuity across stop/resume with the same stable sandbox name

Open implementation note:
- Since we are dropping the direct path, implementation should remove that branch early so the rest of the migration only has one execution path to reason about.