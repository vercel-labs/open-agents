Summary: Refactor chat stream/sandbox orchestration out of the large chat route files into focused controllers, and make reconnect behavior single-flight + policy-driven so effects cannot trigger repeated connect/reconnect loops.

Context: Key findings from exploration -- existing patterns, relevant files, constraints
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-context.tsx`
  - Owns `retryChatStream` and `stopChatStream` behavior.
  - `retryChatStream` currently defaults to `hard` strategy and always calls `resumeStream()`; automatic callers can repeatedly trigger reconnect attempts.
  - Good existing guard already present: `userStoppedRef` prevents auto-retry after explicit user stop.
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx`
  - Contains multiple reconnect-related effects and refs (`maybeRecoverStreamRef`, focus/visibility/online listeners, stall timeout recovery, reconnect-on-entry, auto-restore, auto-create, status polling).
  - Recovery can be triggered from multiple paths (error recovery + silent-stall probe), which increases chances of reconnect churn/jank under unstable network/tab visibility transitions.
  - File is very large (3.5k+ lines), so stream/sandbox orchestration is hard to reason about and easy to regress.
- Reusable prior-art pattern:
  - `apps/web/hooks/use-session-chats.ts` uses explicit overlay state, grace windows, and server-confirmation flags to avoid UI thrash. We should mirror that “state machine + cooldown” style for stream recovery.

Approach: High-level design decision and why
- Keep behavior-compatible UX, but move reconnection logic behind explicit controllers with stable identities and single-flight guards.
- Separate “manual retry” and “automatic recovery” semantics:
  - Manual retry can stay aggressive (`hard`).
  - Automatic recovery should be conservative (`soft` first), cooldown-gated, and no-op while a reconnect attempt is already in progress.
- Extract orchestration from `session-chat-content.tsx` into dedicated hooks so rendering concerns are separated from lifecycle/effect concerns.
- Add targeted unit tests for recovery policy transitions so we can refactor safely without reintroducing reconnect loops.

Changes:
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-context.tsx` -
  - Refactor `retryChatStream` into a stable, guarded retry API backed by refs (single-flight reconnect, per-attempt cooldown, auto vs manual strategy split).
  - Preserve `userStoppedRef` behavior, but ensure auto-recovery cannot repeatedly re-enter `resumeStream()` while one retry is already running.
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx` -
  - Remove inline reconnect orchestration blocks and consume extracted hooks.
  - Keep UI rendering and event handlers in place; reduce effect surface in this component.
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/use-chat-stream-recovery.ts` (new) -
  - Own stream recovery triggers (visibility/focus/online/stall) with explicit guards and cooldown windows.
  - Centralize decision logic for when auto-recovery is allowed.
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/use-sandbox-lifecycle-orchestration.ts` (new) -
  - Own entry-time reconnect/restore/create/status-poll sequencing to avoid overlapping effects and accidental repeated probes.
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/chat-stream-recovery-policy.ts` (new) -
  - Pure helper(s) for recovery decisions and transition resets (easy to test and reason about).
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/chat-stream-recovery-policy.test.ts` (new) -
  - Unit tests for cooldown, single-flight gating, status-transition reset behavior, and auto/manual strategy selection.

Verification:
- Automated checks:
  - `bun test apps/web/app/sessions/[sessionId]/chats/[chatId]/chat-stream-recovery-policy.test.ts`
  - `bun run lint -- --filter=web`
  - `bun run typecheck -- --filter=web`
- End-to-end behavior checks (manual):
  - Start a long-running response, switch tab visibility/focus repeatedly, and confirm reconnect attempts do not loop continuously.
  - Simulate transient network loss/recovery and confirm at most one auto-reconnect attempt per cooldown window.
  - Confirm manual “Retry” still reliably reconnects.
  - Confirm explicit user stop is still respected (no automatic restart).
