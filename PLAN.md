Summary: Keep the new lifecycle rule that any non-null chat `activeStreamId` blocks hibernation, but make `activeStreamId` cleanup more reliable so stale stream markers do not keep sessions stuck forever or block the next prompt.

Context: `apps/web/lib/sandbox/lifecycle.ts` now treats `activeStreamId` as the authoritative “workflow is still active” signal and rechecks it right before snapshotting, which is the right protection against long-running chat workflows being hibernated mid-run. The remaining gap is stale cleanup: `apps/web/app/workflows/chat-post-finish.ts` clears the stream id on a best-effort basis, and `apps/web/app/api/chat/route.ts` currently inspects an existing run but does not clear a terminal/not-found stream id before trying to claim a new run. If that stale id lingers, lifecycle keeps skipping hibernation and a later chat submit can lose its CAS claim even though nothing is actually running.

Approach: Preserve the lifecycle evaluator exactly as the new change intends, and instead harden the two places responsible for stream-id correctness: (1) retry workflow-finish cleanup so transient DB failures do not strand stale ids, and (2) reconcile terminal/not-found ids on the chat-start path before launching a new workflow so stale state self-heals the next time the chat is used.

Changes:
- `apps/web/app/workflows/chat-post-finish.ts` - make `clearActiveStream` retry `compareAndSetChatActiveStreamId(chatId, workflowRunId, null)` a few times before giving up, while still avoiding clobbering a newer workflow id.
- `apps/web/app/workflows/chat-post-finish.test.ts` - add regression coverage for transient clear failures being retried and for the helper remaining non-throwing after retries are exhausted.
- `apps/web/app/api/chat/route.ts` - when a chat already has `activeStreamId`, reconnect immediately only for `running`/`pending` runs; otherwise clear the stale id with CAS (and re-read if needed) before starting a new workflow so stale terminal ids do not cause false 409s.
- `apps/web/app/api/chat/route.test.ts` - cover stale completed/not-found run ids being cleared before a new run is started, while keeping the reconnect-on-running behavior unchanged.

Verification:
- Targeted tests:
  - `bun test apps/web/app/workflows/chat-post-finish.test.ts`
  - `bun test apps/web/app/api/chat/route.test.ts`
  - `bun test apps/web/lib/sandbox/lifecycle-evaluate.test.ts`
- Full validation:
  - `bun run ci`
- Edge cases to check:
  - a long-running workflow with non-null `activeStreamId` still blocks hibernation
  - a completed or missing workflow run no longer causes the next `/api/chat` request to fail with a false “already running” conflict
  - transient DB failures while clearing `activeStreamId` are retried without clearing a newer workflow id