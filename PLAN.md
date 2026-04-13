Summary: Close the free-user message deletion loophole by moving the hosted-trial message cap off live chat history and onto an immutable per-message reservation record. This keeps delete behavior unchanged while making the 5-message cap lifetime-based and idempotent.

Context: The current gate in `apps/web/app/api/chat/route.ts` calls `countUserMessagesByUserId`, which counts live `chat_messages` rows. Message deletion in `apps/web/app/api/sessions/[sessionId]/chats/[chatId]/messages/[messageId]/route.ts` physically removes those rows through `deleteChatMessageAndFollowing`, so a user can delete prior prompts and drop back under the cap. The current count is therefore using display/history data as quota state.

System Impact: The source of truth for hosted-trial message usage changes from mutable chat history to a dedicated immutable reservation table keyed by message ID + user. `chat_messages` remains the source of truth for visible conversation history only. New invariant: each unique user message ID can consume trial quota at most once; deleting chat history never restores quota; retrying the same message ID does not consume extra quota.

Approach: Add a small DB-backed reservation layer specifically for managed-template trial gating. In `POST /api/chat`, when the latest user message is new, reserve one hosted-trial message before starting the workflow. The reservation helper should run in a transaction, serialize on the user row, allow replays of the same `messageId`, and reject the sixth unique message. This is smaller and more coherent than soft-deleting chat messages or rewriting all message queries to ignore deleted rows.

Changes:
- `apps/web/lib/db/schema.ts` - add a dedicated managed-template trial message reservation table (persistent across chat/message deletion) with a unique `messageId` and `userId` foreign key.
- `apps/web/lib/db/managed-template-trial.ts` - add DB helpers to reserve a trial message idempotently and count/check against the 5-message limit inside one transaction.
- `apps/web/app/api/chat/route.ts` - replace the current live-message count check with the reservation helper for managed-template trial users.
- `apps/web/app/api/chat/route.test.ts` - update mocks/tests to cover: sixth unique message blocked, same `messageId` retry allowed, and quota enforcement no longer depends on existing chat history.
- `apps/web/lib/db/migrations/*` - generate the Drizzle migration and snapshot for the new table.

Verification:
- Run `bun run ci`.
- Confirm the chat route still allows the first five unique managed-template trial messages and rejects the sixth.
- Confirm retrying the same request/message ID does not consume another slot.
- Confirm deleting prior chat messages does not make a sixth unique message allowed again.
