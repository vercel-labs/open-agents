Summary: Add a fork action on assistant responses that creates a new chat from the current chat up to the selected assistant message, then opens that forked chat.

Context: Assistant response actions are rendered in [apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx](#workspace-file=apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx). Session chat list state and optimistic chat creation live in [apps/web/hooks/use-session-chats.ts](#workspace-file=apps/web/hooks/use-session-chats.ts). Server chat ownership guards already exist in [apps/web/app/api/sessions/_lib/session-context.ts](#workspace-file=apps/web/app/api/sessions/_lib/session-context.ts), and chat/message persistence lives in [apps/web/lib/db/sessions.ts](#workspace-file=apps/web/lib/db/sessions.ts). The cleanest boundary is to treat “fork” as an action on an existing chat, backed by persisted messages as the source of truth.

System Impact: The source of truth stays server-side: the fork is created from persisted chat messages, not client state. This adds one new server action that duplicates a chat subset into a new chat, plus a client-side optimistic chat entry while the request is in flight. No existing chat/message schema changes are needed.

Approach: Add a dedicated fork endpoint under the existing chat resource, plus a small DB transaction helper that creates the new chat and copies messages through the selected assistant message with fresh message IDs. On the client, add a fork button beside the assistant copy button and reuse the existing session chat hook for optimistic chat insertion and navigation.

Changes:
- `apps/web/app/api/sessions/[sessionId]/chats/[chatId]/fork/route.ts` - add authenticated fork endpoint for the current chat; validate input, handle requested chat-id reuse/conflicts, and call the DB fork helper.
- `apps/web/app/api/sessions/[sessionId]/chats/[chatId]/fork/route.test.ts` - cover auth, ownership, validation, conflict handling, and successful fork responses.
- `apps/web/lib/db/sessions.ts` - add a transaction helper that creates the forked chat and copies source messages through the selected assistant message with fresh top-level message IDs.
- `apps/web/hooks/use-session-chats.ts` - add an optimistic `forkChat` helper that creates a temporary chat entry and persists it through the new endpoint.
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx` - render the new fork button next to copy on assistant responses and invoke the new hook action.

Verification:
- Run `bun run check`
- Run `bun run typecheck`
- Run targeted tests for the new/updated chat API coverage
- Run `bun run ci`
- Edge cases: selected assistant message not found, requested chat ID conflicts, fork request failure after optimistic insertion, copied chats should not show unread state from historical assistant messages, and only messages up to the selected assistant response should be copied.