# React Best Practices Audit: `apps/web`

Audited against the Vercel React Best Practices (57 rules, 8 categories). Findings are ordered by impact.

---

## 1. Eliminating Waterfalls -- CRITICAL

### ~~1a. Sequential `await` chains in Server Components~~ FIXED

**Rule violated:** `async-parallel` (Promise.all for independent operations)

`app/sessions/[sessionId]/chats/[chatId]/page.tsx:67-93` -- Four sequential `await` calls where some are independent:

```typescript
const session = await getServerSession();     // 1. auth
const sessionRecord = await getSessionById(sessionId); // 2. depends on nothing
const chat = await getChatByIdWithRetry(chatId, sessionId); // 3. depends on sessionId only
const dbMessages = await getChatMessages(chatId); // 4. depends on chatId only
```

`getServerSession()` and `getSessionById()` are independent and could run in parallel. After the ownership check, `getChatByIdWithRetry` and `getChatMessages` could also overlap (chatId is known from params, not from the session fetch).

**Fix:** Start independent promises early, await late:

```typescript
const sessionPromise = getServerSession();
const sessionRecordPromise = getSessionById(sessionId);
const session = await sessionPromise;
if (!session?.user) redirect("/");
const sessionRecord = await sessionRecordPromise;
// ... ownership check ...
const [chat, dbMessages] = await Promise.all([
  getChatByIdWithRetry(chatId, sessionId),
  getChatMessages(chatId),
]);
```

### 1b. Missing Suspense boundaries

**Rule violated:** `async-suspense-boundaries`

There are **zero** `loading.tsx` files and **zero** `error.tsx` files in the entire app. Only one `<Suspense>` boundary exists (`app/settings/accounts/page.tsx:8`). The root layout (`app/layout.tsx:24-39`) has no Suspense wrapping `{children}`.

This means:

- No streaming SSR for any page
- The entire page tree (including the retry loop at `page.tsx:31-48` that can block for up to 5 seconds) must resolve before anything paints

**Fix:** Add `<Suspense>` boundaries in page.tsx files around data-dependent content, and add `loading.tsx` files for key route segments.

### 1c. Blocking retry loop

`app/sessions/[sessionId]/chats/[chatId]/page.tsx:31-48` -- `getChatByIdWithRetry` can do 50 retries x 100ms = 5 seconds of blocking in the server component render. This blocks the entire page with no streaming or fallback UI.

---

## 2. Bundle Size Optimization -- CRITICAL

### ~~2a. No `next/dynamic` usage anywhere~~ FIXED

**Rule violated:** `bundle-dynamic-imports`

The entire codebase has **zero** `next/dynamic` or `import()` calls for lazy-loading components. Every component is statically imported. Heavy, on-demand-only components are eagerly bundled:

| Component | File | Lines | When Used |
|-----------|------|-------|-----------|
| `DiffViewer` | `diff-viewer.tsx` | ~308 | Modal opened on button click |
| `CreatePRDialog` | `create-pr-dialog.tsx` | ~686 | Modal opened on button click |
| `CreateRepoDialog` | `create-repo-dialog.tsx` | ~348 | Modal opened on button click |
| `Streamdown` (shiki) | External dependency | Large | Only during message rendering |

All are imported at `session-chat-content.tsx:43-52,83`.

**Fix:** Use `next/dynamic` with `{ ssr: false }` for dialog/modal components:

```typescript
const DiffViewer = dynamic(
  () => import("./diff-viewer").then(m => m.DiffViewer),
  { ssr: false }
);
const CreatePRDialog = dynamic(
  () => import("@/components/create-pr-dialog").then(m => m.CreatePRDialog),
  { ssr: false }
);
```

### ~~2b. Barrel imports from `lucide-react`~~ FIXED

**Rule violated:** `bundle-barrel-imports`

`session-chat-content.tsx:6-29` imports **22 icons** via barrel export:

```typescript
import {
  Archive, ArchiveRestore, ArrowDown, ArrowLeft, ArrowUp,
  Check, Copy, ExternalLink, FolderGit2, GitCompare,
  GitPullRequest, Link2, Loader2, Menu, MessageSquare,
  Mic, Paperclip, Pencil, Plus, Share2, Square, Trash2, X,
} from "lucide-react"
```

This loads the entire `lucide-react` module graph (~1,583 modules).

**Fix:** Add `lucide-react` to `optimizePackageImports` in `next.config.ts`:

```typescript
const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  // ...
};
```

---

## 3. Server-Side Performance -- HIGH

### ~~3a. Context provider value not memoized~~ FIXED

**Rule violated:** `server-serialization` + `rerender-memo`

`session-chat-context.tsx:853-892` -- The `SessionChatContext.Provider` value is an inline object literal with ~40 properties, recreated every render. While individual callbacks inside are memoized with `useCallback`, the value object itself is not wrapped in `useMemo`. This causes all consumers to re-render whenever the provider re-renders.

**Fix:** Wrap the value in `useMemo`:

```typescript
const contextValue = useMemo(() => ({
  session: sessionRecord,
  chatInfo,
  chat,
  // ... all 40 properties
}), [sessionRecord, chatInfo, chat, /* ... relevant deps */]);

return (
  <SessionChatContext.Provider value={contextValue}>
    {children}
  </SessionChatContext.Provider>
);
```

### 3b. Full session record passed to client component

**Rule violated:** `server-serialization` (minimize data at RSC boundaries)

`page.tsx:98` passes the entire `sessionRecord` object to the client provider. Only a subset of fields are actually used by the client components. This increases serialization cost at the RSC boundary.

---

## 4. Re-render Optimization -- MEDIUM

### ~~4a. Derived state not memoized~~ FIXED

**Rule violated:** `rerender-derived-state-no-effect`

`session-chat-content.tsx:689-697` -- Several derived values are recomputed on every render without memoization:

```typescript
const renderMessages = hasMounted ? messages : initialMessages;  // line 689
const lastMessage = renderMessages[renderMessages.length - 1];    // line 690
const showThinkingIndicator = status === "submitted" || ...       // line 691-697
```

During streaming, `messages` changes on every token, so these are recalculated very frequently. `renderMessages` is used in 3+ `useMemo` hooks downstream, so not memoizing it means those downstream memos also re-run.

### ~~4b. `sandboxUiStatus` IIFE on every render~~ FIXED

`session-chat-content.tsx:1476-1521` -- A complex IIFE computing an object literal runs on every render. This should be a `useMemo`:

```typescript
const sandboxUiStatus = useMemo(() => {
  if (isArchived) return { label: "Archived", ... };
  // ...
}, [isArchived, isCreatingSandbox, isRestoringSnapshot, /* ... */]);
```

### 4c. `hasMounted` effect pattern

**Rule violated:** `rerender-derived-state-no-effect`

`session-chat-content.tsx:575-577` -- Uses a `useEffect` just to set `hasMounted`:

```typescript
useEffect(() => { setHasMounted(true); }, []);
```

This causes an extra render on mount. A ref would avoid the extra render if the only purpose is guarding hydration.

### 4d. ~25 useState calls in one component

`session-chat-content.tsx:553-565,698-703` -- The `SessionChatContent` function has approximately 25 `useState` calls and ~15 `useEffect` hooks. This monolithic component means any state change triggers re-evaluation of the entire 2200-line render function. Extracting sub-trees into memoized child components (`memo()`) would significantly reduce work per render.

### ~~4e. Scroll effect triggered too frequently~~ FIXED

**Rule violated:** `rerender-dependencies`

`session-chat-content.tsx:1108-1112`:

```typescript
useEffect(() => {
  if (isAtBottom) { scrollToBottom(); }
}, [messages, isAtBottom, scrollToBottom]);
```

`messages` changes on every streaming token, causing this effect to fire on every token. A more targeted dependency (e.g., `messages.length`) or debouncing would reduce overhead.

---

## 5. Client-Side Data Fetching -- MEDIUM-HIGH

### 5a. Direct `fetch()` bypasses SWR cache

**Rule violated:** `client-swr-dedup`

Multiple components make direct `fetch()` calls for data that SWR already caches:

- `CreateRepoDialog` fetches `GET /api/github/installations` with raw `fetch()`, but `RepoSelectorCompact` fetches the same endpoint via SWR. The direct `fetch()` misses the SWR cache and deduplication.

**Fix:** Use `useSWR` or `useSWRMutation` consistently for all data fetching.

---

## 6. Rendering Performance -- MEDIUM

### 6a. Conditional rendering with `&&`

**Rule violated:** `rendering-conditional-render`

There are likely instances of `{condition && <Component />}` patterns throughout the codebase. When `condition` is `0` or `""`, React renders those falsy values. Prefer explicit ternaries: `{condition ? <Component /> : null}`.

---

## 7. Unused Code / Dead Weight

### 7a. Unused dependencies

- `react-hook-form` and `@hookform/resolvers` are in `package.json` but never imported in any application component.
- `app/chat-context.tsx` exports `ChatProvider`/`useChatContext` but no route imports it. This is likely legacy code.

### 7b. No error boundaries

No `error.tsx` files exist in any route segment and no `<ErrorBoundary>` components are used. If any server component throws, users see the default Next.js error page.

---

## Summary by Priority

| Priority | Issue | Rule | Impact | Status |
|----------|-------|------|--------|--------|
| **CRITICAL** | Sequential awaits in page.tsx | `async-parallel` | 2-3x slower page load | FIXED |
| **CRITICAL** | No Suspense boundaries | `async-suspense-boundaries` | No streaming, 5s blocking possible | |
| **CRITICAL** | No dynamic imports for modals | `bundle-dynamic-imports` | Inflated initial bundle | FIXED |
| **CRITICAL** | Barrel imports from lucide-react | `bundle-barrel-imports` | +200-800ms cold start | FIXED |
| **HIGH** | Context value not memoized (40 props) | `rerender-memo` | All context consumers re-render | FIXED |
| **HIGH** | Monolithic 2200-line component | `rerender-memo` | No render bailouts possible | |
| **MEDIUM** | Derived state not memoized | `rerender-derived-state` | Unnecessary per-token work | FIXED |
| **MEDIUM** | Scroll effect on every token | `rerender-dependencies` | Excessive effect runs | FIXED |
| **MEDIUM** | sandboxUiStatus IIFE | `rerender-memo` | Unnecessary per-render work | FIXED |
| **MEDIUM** | Direct fetch bypasses SWR | `client-swr-dedup` | Duplicate network requests | |
| **LOW** | Unused dependencies | `bundle-*` | Unnecessary package weight | |
| **LOW** | No error boundaries | N/A | Poor error UX | |

The highest-impact improvements would be:

1. Adding `optimizePackageImports` for lucide-react
2. Using `next/dynamic` for modal components
3. Parallelizing server-side data fetches with `Promise.all`
4. Adding Suspense boundaries to route pages
5. Memoizing the context provider value

These five changes would meaningfully improve both initial load time and runtime render performance.
