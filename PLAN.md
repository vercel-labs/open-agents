Summary: Safely refactor chat streaming/recovery logic to reduce UI jank from repeated reconnect attempts by extracting pure policy first, then moving runtime/recovery orchestration into focused hooks in separate low-risk PRs.

Context:
- Reconnect behavior currently spans two large files:
  - `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-context.tsx`
  - `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx`
- Recovery can be triggered from multiple paths (mount resume, error retry, visibility/focus/online, stall probe), making regressions easy when refactoring.
- Existing code already contains critical safety behavior that must be preserved:
  - user-initiated stop suppresses auto-reconnect
  - resume-on-mount is computed once
  - route cleanup aborts local transport without force-stopping server generation
- We completed PR A (policy extraction + tests), PR B (runtime hook extraction), and PR C (`use-stream-recovery` extraction), and validated all three.

Approach: Use a phased, behavior-preserving extraction plan with one concern per PR. Keep public context API stable until the final optional optimization phase.

Changes:
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/stream-recovery-policy.ts` (COMPLETED)
  - Added pure stream recovery policy helpers:
    - cooldown + stall constants
    - recovery decision function (`none` | `retry-error` | `probe`)
    - stall-delay calculator
    - visibility scheduling helper
    - probe payload type guard
  - No side effects in this module.

- `apps/web/app/sessions/[sessionId]/chats/[chatId]/stream-recovery-policy.test.ts` (COMPLETED)
  - Added unit tests for:
    - cooldown gating
    - error retry decision
    - submitted/stall/probe gating
    - probe-in-flight suppression
    - delay computation edge cases
    - payload validation

- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx` (COMPLETED)
  - Replaced inline recovery decision logic with calls to `stream-recovery-policy` helpers.
  - Removed duplicated in-file recovery constants/type-guard logic.
  - Kept existing behavior and event wiring intact.

- `apps/web/app/sessions/[sessionId]/chats/[chatId]/hooks/use-session-chat-runtime.ts` (COMPLETED)
  - Extracted from `session-chat-context.tsx`:
    - transport creation
    - chat instance lifecycle/reuse
    - `stopChatStream`
    - `retryChatStream`
    - user-stop suppression logic
    - mount-only resume gate
    - route cleanup integration
  - Provider remains API-compatible: `useSessionChatContext()` shape unchanged.

- `apps/web/app/sessions/[sessionId]/chats/[chatId]/hooks/use-stream-recovery.ts` (COMPLETED)
  - Extracted from `session-chat-content.tsx`:
    - visibility/focus/online listeners
    - stall timer scheduling
    - probe in-flight guard
    - last-recovery timestamp handling
  - Depends only on explicit inputs + callbacks from context/content.

- Optional performance phase (PLANNED: only if needed)
  - Split context by concern (stream runtime vs workspace data vs session metadata), while preserving compatibility wrappers.

Verification:
- Per PR automated checks:
  - `bun run ci`
  - `bun run build`
  - Latest PR C run: both checks passed.
- Manual end-to-end checks after each phase:
  - send message → stream starts/updates normally
  - manual stop does not auto-resume unexpectedly
  - transient error path allows retry
  - tab hidden/visible and focus transitions do not cause reconnect loops
  - offline→online recovery does not duplicate/replay chunks
  - stalled submitted turn recovers once (respects cooldown)
- Edge cases:
  - iOS/background wake-up transient fetch failures
  - route transitions during active stream
  - reconnect probe failures (no runaway retry loops)

PR Strategy:
1. PR A (done): recovery policy extraction + tests.
2. PR B (done): `use-session-chat-runtime` extraction only.
3. PR C (done): `use-stream-recovery` extraction only.
4. PR D (optional): context split for render-scope optimization.

This sequencing minimizes blast radius and makes rollback/debugging straightforward if stream behavior regresses.
