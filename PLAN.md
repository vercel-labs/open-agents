Summary: Add a durable, server-side auto-merge flow that users can queue from the merge dialog. The workflow will poll GitHub readiness (poll -> sleep -> poll), auto-merge when checks are ready, archive the session immediately after merge, and expose a state badge in the sidebar.

Context: 
- Manual merge already exists in `apps/web/app/api/sessions/[sessionId]/merge/route.ts` and uses existing GitHub helpers (`getPullRequestMergeReadiness`, `mergePullRequest`, `deleteBranchRef`) from `apps/web/lib/github/client.ts`.
- Merge UX currently lives in `apps/web/components/merge-pr-dialog.tsx`; it loads readiness on demand but has no queue/automation mode.
- Session archiving logic already exists in `apps/web/lib/sandbox/archive-session.ts` and should be reused after successful auto-merge.
- Sidebar row metadata currently comes from `getSessionsWithUnreadByUserId` in `apps/web/lib/db/sessions.ts` and `SessionWithUnread` in `apps/web/hooks/use-sessions.ts`; there is no auto-merge status field yet.
- `useSessions` only polls while a session is streaming; auto-merge status changes would otherwise not refresh promptly.

Approach: Implement a new durable workflow dedicated to auto-merge orchestration, and persist lightweight auto-merge state on the session record so both the workflow and sidebar can coordinate safely. Use a run-id lease pattern (similar to sandbox lifecycle) so disable/cancel and reruns are deterministic. Reuse existing merge and archive primitives instead of duplicating GitHub logic.

Changes:
- `apps/web/lib/db/schema.ts`
  - Add session fields for auto-merge orchestration/status (nullable state enum + run id + failure reason).
- `apps/web/lib/db/migrations/*` and `apps/web/lib/db/migrations/meta/*`
  - Generate migration/snapshot updates for the new session columns.
- `apps/web/lib/db/sessions.ts`
  - Include new auto-merge fields in sidebar session selection (`SessionSidebarFields`) so the UI can render badge state.
- `apps/web/hooks/use-sessions.ts`
  - Extend `SessionWithUnread` with auto-merge fields.
  - Update polling logic to continue refreshing while any session is in an active auto-merge state (queued/waiting/merging).
- `apps/web/lib/github/user-token.ts` and `apps/web/lib/github/get-repo-token.ts`
  - Add a user-id based token retrieval path so background workflows can resolve repo tokens without request-bound session cookies.
- `apps/web/app/workflows/auto-merge.ts` (new)
  - Durable workflow loop: load session lease -> check readiness -> either sleep, fail, or merge.
  - Poll/sleep behavior with bounded timeout.
  - On merge success: perform merge via existing GitHub client helpers, optionally delete source branch, then call `archiveSession(...)` with `prStatus: "merged"` and clear auto-merge state.
  - On failing checks (or non-recoverable blockers): stop and mark failed with a user-facing reason.
- `apps/web/app/api/sessions/[sessionId]/auto-merge/route.ts` (new)
  - POST endpoint to enable/disable auto-merge for a session.
  - Enabling sets queued state and starts the durable workflow.
  - Disabling clears state and cancels active run when present.
- `apps/web/components/merge-pr-dialog.tsx`
  - Add “enable auto-merge” control/action for non-ready PRs.
  - Queue auto-merge via the new API route and surface API errors inline.
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-context.tsx`
  - Add local + SWR cache update helper for auto-merge status fields.
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx`
  - Wire merge dialog auto-merge callbacks into session context updates.
- `apps/web/components/inbox-sidebar.tsx`
  - Add a compact state badge in each session row for auto-merge status (queued/waiting/merging/failed).

Verification:
- Generate migration after schema change:
  - `bun run --cwd apps/web db:generate`
- Run focused tests:
  - `bun test apps/web/app/api/sessions/[sessionId]/merge/route.test.ts`
  - `bun test apps/web/app/api/sessions/[sessionId]/auto-merge/route.test.ts` (new)
  - `bun test apps/web/app/workflows/auto-merge.test.ts` (new)
- Run project checks:
  - `bun run typecheck`
  - `bun run ci`
- Edge cases to validate manually/in-tests:
  - Queueing while checks are pending transitions to waiting and eventually merges.
  - Required checks failing transitions to failed and stops polling.
  - Disable/cancel clears badge state and prevents further merge attempts.
  - PR merged/closed externally clears/terminates auto-merge cleanly.
  - Successful auto-merge archives the session immediately and removes it from active sidebar list.
