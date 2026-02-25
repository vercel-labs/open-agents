# Autoscroll follow-up (dynamic-height components)

## Observed issue
Autoscroll can stop when components with dynamic height (for example, todo lists/tool cards) reflow while a chat response is streaming.

## Likely regression points on this branch

1. `apps/web/hooks/use-scroll-to-bottom.ts`
   - Autoscroll now runs through a coalesced `requestAnimationFrame` path and only scrolls when `nextHeight > previousHeight`.
   - Dynamic layout churn can temporarily mark the viewport as not-at-bottom, which then blocks subsequent auto-scroll updates.

2. `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx`
   - Bottom-pin effect changed to depend on `renderMessages.length` instead of all message-content updates.
   - Streaming updates within the same message (no length change) may not trigger an explicit `scrollToBottom()`.

## Proposed fix for a follow-up PR

### 1) Make resize autoscroll anchor-aware in `use-scroll-to-bottom`
Use whether the user was effectively at-bottom *before* the resize, not only the current `isAtBottom` flag.

Pseudo-logic:

```ts
const threshold = 10;
const previousHeight = lastScrollHeightRef.current;
const wasAtBottomBeforeResize =
  previousHeight - current.scrollTop - current.clientHeight < threshold;

if (!wasAtBottomBeforeResize && !isAtBottomRef.current) return;

const nextHeight = current.scrollHeight;
if (nextHeight !== previousHeight) {
  current.scrollTop = nextHeight;
}
lastScrollHeightRef.current = nextHeight;
```

Notes:
- Scroll on any height change while anchored (not just growth-only).
- Keep RAF batching to avoid scroll-jank from very frequent resize events.

### 2) Broaden bottom-pin trigger in `session-chat-content`
Current effect only reacts to message-count changes:

```ts
useEffect(() => {
  if (isAtBottom) scrollToBottom();
}, [renderMessages.length, isAtBottom, scrollToBottom]);
```

Follow-up change:
- Include content-level streaming updates (for example by depending on `renderMessages` or a stable last-message-content signal), so streaming within the final message still pins to bottom.

## Validation to run in follow-up PR
- Reproduce with dynamic-height tool output (todo list expand/collapse/update while streaming).
- Confirm viewport remains pinned when user has not intentionally scrolled up.
- Confirm no forced jump when user has intentionally scrolled away from bottom.
- Run project checks (typecheck, lint, tests) via repository scripts.
