Summary: Fix the production log noise by treating expected GitHub/workflow/sandbox 403/404 cases as graceful fallbacks, and by preventing duplicate sandbox lifecycle workflow starts that can race each other.

Context: `apps/web/lib/github/client.ts` already intends to ignore forbidden/missing check-run reads, but the status handling is brittle and production is still surfacing 403 logs for optional check-run requests. `apps/web/app/api/chat/[chatId]/stream/route.ts` returns a 200 stream before the workflow runtime can emit late run-not-found errors, and `apps/web/lib/chat/create-cancelable-readable-stream.ts` currently treats those late 404s as fatal. Sandbox routes only classify 410-style sandbox expiration as unavailable even though the underlying sandbox APIs can also return 404-style not-found errors. `apps/web/lib/sandbox/lifecycle-kick.ts` starts lifecycle workflows before any lease is persisted, so overlapping kicks can launch duplicate short-lived runs that race to claim the same session.

Approach: Keep the successful paths unchanged, but normalize these expected external-service failure modes so they degrade quietly instead of throwing noisy errors. For lifecycle management, make the session lease claim happen before starting the workflow so concurrent kicks collapse to one owner.

Changes:
- `apps/web/lib/github/client.ts` - add a small helper to extract/normalize GitHub HTTP status codes from unknown errors and use it so optional check-run/status fetches consistently suppress 403/404 noise while preserving fallback behavior.
- `apps/web/lib/chat/create-cancelable-readable-stream.ts` - treat workflow run-not-found 404 errors the same as abort/disconnect shutdown so late stream failures close cleanly instead of surfacing as unhandled rejections.
- `apps/web/lib/chat/create-cancelable-readable-stream.test.ts` - add regression coverage for the workflow 404 shutdown case.
- `apps/web/lib/sandbox/utils.ts` - recognize 404 sandbox-not-found responses as sandbox-unavailable alongside the existing 410 handling.
- `packages/sandbox/vercel/direct.ts` - treat 404 direct-sandbox failures as reconnectable/unavailable just like 410 so callers can recover instead of bubbling raw transport errors.
- `packages/sandbox/vercel/direct.test.ts` and/or `apps/web/app/api/sandbox/reconnect/route.test.ts` - add coverage for the 404 sandbox-unavailable path.
- `apps/web/lib/db/sessions.ts` - add a targeted compare-and-set helper for claiming `lifecycleRunId` only when it is still null.
- `apps/web/lib/sandbox/lifecycle-kick.ts` - use the new atomic claim before starting `sandboxLifecycleWorkflow`, and clear the claim on startup failure before the inline fallback path.
- `apps/web/lib/sandbox/lifecycle-kick.test.ts` - add focused coverage showing overlapping kicks only start one lifecycle workflow lease.

Verification:
- Targeted tests:
  - `bun test apps/web/lib/chat/create-cancelable-readable-stream.test.ts`
  - `bun test packages/sandbox/vercel/direct.test.ts`
  - `bun test apps/web/app/api/sandbox/reconnect/route.test.ts`
  - `bun test apps/web/lib/sandbox/lifecycle-kick.test.ts`
  - `bun test apps/web/app/api/sessions/[sessionId]/merge/route.test.ts`
- Full validation:
  - `bun run ci`
- Edge cases to confirm:
  - merge-readiness still returns data when checks/check-runs are forbidden
  - reconnecting to a stale chat stream closes cleanly instead of logging an unhandled 404
  - stale/missing sandboxes are marked unavailable on both 404 and 410 responses
  - repeated lifecycle kicks do not start duplicate workflow runs for one session
