# Chat Stop Resume Regression Test Plan

This checklist covers the regression where Stop fails after switching chats while a resumable stream is active.

## Scope

- Session chat route: `apps/web/app/sessions/[sessionId]/chats/[chatId]`
- Streaming + resumable stream reconnect behavior
- Stop button behavior for active and resumed streams

## Preconditions

- A logged-in user with an active session
- At least two chats in the same session
- A prompt that reliably streams for at least 10-20 seconds

## Manual Test Cases

### 1. Baseline stop in current chat

1. Open a chat.
2. Send a long-running prompt.
3. Click Stop while it is streaming.

Expected:
- Stream stops immediately.
- Input returns to editable state.
- No refresh required.

### 2. Switch away and back during stream

1. In Chat A, start a long-running prompt.
2. Navigate to Chat B before Chat A finishes.
3. Navigate back to Chat A.
4. Click Stop.

Expected:
- Stream stops immediately.
- Stop works on the first click.
- No page refresh required.

### 3. Resume path after hard refresh

1. In Chat A, start a long-running prompt.
2. Refresh the page while it is streaming.
3. Wait for stream resume.
4. Click Stop.

Expected:
- Resumed stream stops immediately.
- No stuck streaming indicator.

### 4. Rapid navigation stress test

1. Start stream in Chat A.
2. Rapidly switch A -> B -> A several times while streaming.
3. Click Stop in Chat A.

Expected:
- Stop remains reliable.
- No duplicate assistant messages are appended.
- UI remains responsive.

## Optional Observability Checks

- Network tab should show the chat stream request canceled immediately after Stop.
- No persistent hanging stream request should remain after navigating away.

## Pass Criteria

- All manual test cases pass without page refresh workarounds.
- Stop works consistently for both in-place streams and resumed streams.
