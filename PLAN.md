Summary: Close the free-user message deletion loophole with the smallest workable change: store a persistent hosted-trial message counter on the user record and stop deriving quota from deletable chat history.

Context: The current gate in `apps/web/app/api/chat/route.ts` calls `countUserMessagesByUserId`, which counts live `chat_messages` rows in `apps/web/lib/db/sessions.ts`. Deleting a message chain in `apps/web/app/api/sessions/[sessionId]/chats/[chatId]/messages/[messageId]/route.ts` removes those rows, so users can drop back under the cap. A boolean like `trialExhausted` is not enough by itself, because users can keep deleting messages before they ever hit the fifth live row.

System Impact: The source of truth for hosted-trial usage changes from mutable chat history to `users.managedTemplateTrialMessageCount`. `chat_messages` remains only conversation history. New invariant: the counter only goes up, delete never gives quota back, and the request is blocked once the counter reaches 5.

Approach: Use a persistent integer counter on the user table, not a separate reservation table. For managed-template trial users, treat a newly accepted user message as quota consumption and increment the counter before starting the workflow. To keep this reasonably safe, do the counter increment together with user-message persistence for that request path instead of relying on the current fire-and-forget persistence.

Changes:
- `apps/web/lib/db/schema.ts` - add `managedTemplateTrialMessageCount integer not null default 0` to `users`.
- `apps/web/lib/db/users.ts` (or a small dedicated helper) - add a helper that checks/increments the counter for managed-template trial users.
- `apps/web/app/api/chat/route.ts` - replace the current live-message count check with the persistent counter check, and make trial-user message persistence/counter update happen before the workflow starts.
- `apps/web/app/api/chat/route.test.ts` - cover: first five messages allowed, sixth blocked, and deleting chat history does not restore quota.
- `apps/web/lib/db/migrations/*` - generate the Drizzle migration and snapshot for the new column.

Verification:
- Run `bun run ci`.
- Confirm managed-template trial users can send exactly 5 messages total.
- Confirm deleting old messages does not allow a 6th message.
- Confirm non-trial users are unaffected.
