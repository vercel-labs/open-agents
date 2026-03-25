Summary: Make assistant-mentioned workspace files clickable in live session chats by having the agent emit a reserved markdown link format, then intercept those links in Streamdown and open a live file viewer overlay. Keep shared/public pages non-interactive for now.

Context: Live chat assistant text is rendered in `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx` with `Streamdown` and plugins from `apps/web/lib/streamdown-config.tsx`. Shared chat pages render the same markdown separately in `apps/web/app/shared/[shareId]/shared-chat-content.tsx`. The session workspace already exposes a file list through `useSessionFiles` and `/api/sessions/[sessionId]/files`, but there is no endpoint for fetching a file’s current contents. The chat runtime already supports extra system-prompt instructions through `agentOptions.customInstructions` in `apps/web/app/api/chat/route.ts`, so we can scope the formatting change to the web chat flow instead of changing the shared agent package. User decisions: live session only, open the current sandbox file, whole-file links only in v1.

Approach: Add a small web-only helper that owns the internal file-link format and the prompt instruction given to the agent. Future assistant responses will emit markdown links such as `[apps/web/lib/streamdown-config.tsx](#workspace-file=apps/web/lib/streamdown-config.tsx)`. In the live session renderer, pass a custom `a` component into `Streamdown` so those reserved hrefs open a file viewer overlay instead of navigating. Back that viewer with a new authenticated session API route that validates the requested path and reads the current file from the sandbox. On shared/public pages, detect the same reserved hrefs but render them as inert file labels so the UI does not navigate to a dead hash.

Changes:
- `apps/web/lib/assistant-file-links.ts` - define the reserved href prefix, parse/build helpers, and the custom prompt instruction string for file links.
- `apps/web/app/api/chat/route.ts` - pass the file-link custom instructions into `agentOptions` when starting the workflow.
- `apps/web/app/api/sessions/[sessionId]/files/content/route.ts` - add an authenticated endpoint that validates a repo-relative path, rejects traversal/invalid targets, and returns the current sandbox file contents.
- `apps/web/app/api/sessions/[sessionId]/files/content/route.test.ts` - cover auth/ownership failures, invalid paths, missing files, and successful reads.
- `apps/web/components/assistant-file-link.tsx` - render reserved file hrefs as inline file chips/buttons while preserving normal anchor behavior for external links.
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/workspace-file-viewer.tsx` - add the modal/drawer overlay that fetches and displays the selected file content.
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx` - wire Streamdown link rendering, manage selected-file state, and mount the viewer.
- `apps/web/app/shared/[shareId]/shared-chat-content.tsx` - render reserved file links as non-interactive labels on shared pages.

Verification:
- Run targeted tests for the new file-link helper and file-content route.
- Run `bun run ci` from the repo root.
- Browser/manual check in a live session: confirm a file link opens the overlay with live file contents, normal external links still work normally, and shared/public pages show the same file label without trying to open a modal.
- Edge cases to check: invalid/traversal paths, deleted or missing files, directories, oversized/non-text files, and assistant messages that still contain normal markdown links.