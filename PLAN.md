Summary: Derive chat-header git action state from persisted chat message git parts instead of local optimistic commit state, while keeping preview deployment freshness based on the existing preview-URL comparison.

Context:
- The header in `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx` currently mixes two local heuristics: `useAutoCommitStatus` for “Committing...” and `branchPreviewUrlChangeBaseline` for “Deploying…”.
- Agent turns already stream and persist `data-commit` / `data-pr` parts from `apps/web/app/workflows/chat.ts`.
- Manual commit and PR flows already write the same synthetic assistant git messages from `apps/web/components/commit-dialog.tsx` and `apps/web/components/create-pr-dialog.tsx`.
- `apps/web/lib/chat-streaming-state.ts` already understands git parts for in-flight UI, so it is the natural place to centralize message-derived navbar state.
- Confirmed requirements: state is chat-scoped, deployment freshness stays as-is, overflow menu should match the primary action, and terminal `error` / `skipped` states should fall back to normal actions.

System Impact:
- Source of truth for commit / PR progress in the navbar shifts from transient client-only optimistic state to persisted chat history.
- Deployment freshness remains client-derived from preview URL polling, but the trigger for “a new deploy should be expected” can be tied to message-derived commit completion for the active chat.
- No backend protocol changes are needed because the required git action state is already embedded in messages.

Approach:
- Add a small helper that inspects the current chat’s latest assistant git parts and derives the active navbar git state (`creating-commit`, `creating-pr`, or idle).
- Use that derived state in both the primary header button and the overflow menu so labels, icons, and disabled states stay aligned.
- Keep preview polling and stale-preview detection intact, but trigger the stale-preview baseline off the message-derived commit completion transition instead of `isAutoCommitting`.
- Treat only pending git parts as dynamic navbar states; once the latest git part resolves to `success`, `error`, or `skipped`, fall back to the normal action selection logic.

Changes:
- `apps/web/lib/chat-streaming-state.ts` - add helper(s) to derive the latest navbar git action state from chat messages / git parts.
- `apps/web/lib/chat-streaming-state.test.ts` - add coverage for pending commit, pending PR, resolved states, and latest-message precedence.
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx` - replace header/menu commit state usage with message-derived state and switch deploy-stale triggering to the derived commit completion transition.
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/commit-action-button.tsx` - generalize from auto-commit-specific copy to message-derived pending labels.
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/hooks/use-auto-commit-status.ts` and its test - remove if no longer needed after the message-derived flow is wired in.

Verification:
- Run `bun run ci`.
- In a chat with auto-commit enabled, confirm the header and overflow menu show pending commit / PR labels from streamed git parts.
- Confirm successful, skipped, or failed git parts return the navbar to normal actions.
- Confirm manual commit and manual PR creation still update the navbar via their synthetic assistant git messages.
- Confirm preview still shows “Deploying…” until the preview URL changes after a pushed commit.