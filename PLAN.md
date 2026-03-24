Summary: Add clickable file references in assistant responses by having the agent emit a deterministic markdown link format for workspace files, then intercept those links in the chat renderer to open a file viewer overlay.

Context:
- Assistant markdown in the live chat view is rendered in `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx` via `Streamdown` with shared plugins from `apps/web/lib/streamdown-config.tsx`.
- Shared/public chat pages render assistant markdown separately in `apps/web/app/shared/[shareId]/shared-chat-content.tsx` and do not currently have access to session sandbox state.
- Workspace file paths already exist in session state via `useSessionFiles` / `/api/sessions/[sessionId]/files`, but there is no route yet for opening a file’s current contents from the sandbox.
- The runtime agent prompt in `packages/agent/system-prompt.ts` already tells the model to mention repo-relative files, but not in a machine-readable format that the renderer can reliably intercept.
- `Streamdown` supports custom link/component rendering, so the renderer can treat a reserved href pattern as an in-app file action instead of a normal navigation link.

Open questions:
- Should file-open links work only in the authenticated live session view for now, or also on shared/public chat pages?
- Should the overlay show the file’s live sandbox contents, and do we want to support optional line ranges in the first version?
