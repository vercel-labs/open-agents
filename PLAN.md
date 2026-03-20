Summary: Switch the app from a v1-style ephemeral runtime model to true v2 persistent sandboxes. The migration keeps the existing session UX, but changes persisted sandbox state so a stopped sandbox can be resumed by name instead of requiring snapshot-only restoration.

Context: The sandbox wrapper is already on the v2 SDK, but the web app still treats `sandboxId` as “active runtime exists”. That assumption is baked into `apps/web/lib/sandbox/utils.ts`, lifecycle hibernation in `apps/web/lib/sandbox/lifecycle.ts`, reconnect/status routes, archive handling, and the session chat UI. In v2, the sandbox name persists across stops; only the session is ephemeral.

Approach: Keep `sandboxId` as the persisted sandbox name, add/use `sessionId` as the live-runtime marker, and preserve sandbox identity when a sandbox is stopped. Reconnect/resume flows should resume persistent sandboxes automatically when only the sandbox name remains. Explicit snapshots stay supported as a legacy/manual path, but they are no longer the primary resume mechanism.

Changes:
- `packages/sandbox/vercel/sandbox.ts` / `packages/sandbox/vercel/connect.ts` - default to persistent sandboxes and allow reconnect-by-name to resume stopped sandboxes while still tracking the current session id.
- `apps/web/lib/sandbox/utils.ts` - split “persistent sandbox exists” from “active runtime session exists”, and add a runtime-clear helper that preserves sandbox identity.
- `apps/web/lib/sandbox/lifecycle.ts` - hibernate by stopping the persistent sandbox and preserving its identity instead of relying on snapshot-only restoration.
- `apps/web/app/api/sandbox/reconnect/route.ts` - resume a persistent sandbox when only the sandbox name remains; only fully clear state when the sandbox artifact is truly gone.
- `apps/web/app/api/sandbox/status/route.ts` - report paused vs active based on `sessionId`/expiry rather than sandbox name alone.
- `apps/web/app/api/sandbox/route.ts` - manual stop should preserve the sandbox identity for future resume.
- `apps/web/lib/sandbox/archive-session.ts` and `apps/web/app/api/sessions/[sessionId]/route.ts` - archived sessions should keep the persistent sandbox identity so unarchive can resume the same sandbox.
- `apps/web/app/api/sessions/[sessionId]/diff/route.ts`, `files/route.ts`, `skills/route.ts` - clear only runtime session data when a session goes stale, so the persistent sandbox can still be resumed.
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-context.tsx` / `session-chat-content.tsx` - treat a saved sandbox name as resumable, auto-resume persistent sandboxes on entry, and only show “Create sandbox” when no persistent sandbox exists.
- Tests covering reconnect, lifecycle hibernation, archived sessions, and UI resume behavior.

Verification:
- `bun run typecheck`
- `bun run lint`
- `bun run test:isolated`
- `bun run build`
- `bun run ci`
- Manual behavior checks: create sandbox → stop/hibernate → revisit session → auto-resume same sandbox; archive → unarchive → resume same sandbox; stale session id should recover by resuming, not by creating a new sandbox.
