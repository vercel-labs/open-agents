Summary: Close the free-user message deletion loophole with the smallest product-level change: on the hosted deployment, non-Vercel trial users cannot delete chat messages.

Context: The current 5-message cap in `apps/web/app/api/chat/route.ts` is derived from live `chat_messages`. Deleting messages through `apps/web/app/api/sessions/[sessionId]/chats/[chatId]/messages/[messageId]/route.ts` removes those rows, which is the loophole. If the main goal is just to stop hosted-demo abuse quickly, preventing delete for managed-template trial users is the smallest direct fix.

System Impact: No quota source-of-truth changes. Instead, the deletion capability changes for one user segment: managed-template trial users on the hosted deployment lose message deletion. Existing message-limit logic remains as-is. New invariant: trial users cannot reduce their live message count by deleting messages.

Approach: Add a server-side guard in the message-delete route using the existing managed-template trial detection. Return a 403 with a clear error for managed-template trial users. Optionally hide or disable the delete UI for the same segment, but the server check is the real protection.

Changes:
- `apps/web/app/api/sessions/[sessionId]/chats/[chatId]/messages/[messageId]/route.ts` - block delete for managed-template trial users on the hosted deployment.
- `apps/web/app/api/sessions/[sessionId]/chats/[chatId]/messages/[messageId]/route.test.ts` - add coverage for the 403 guard.
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx` - optionally hide/disable delete controls and show a clearer message for trial users.

Verification:
- Run `bun run ci`.
- Confirm managed-template trial users get 403 when attempting to delete.
- Confirm their sixth message is still blocked by the existing chat limit.
- Confirm Vercel users and self-hosted deployments can still delete messages normally.
