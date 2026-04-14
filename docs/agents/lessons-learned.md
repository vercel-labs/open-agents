# Lessons Learned

Hard-won knowledge from building this codebase. When you make a mistake or discover a non-obvious behavior, add it here.

## General / Tooling

- Skill discovery de-duplicates by first-seen name, so project skill directories must be scanned before user-level directories to allow project overrides.
- The system prompt should list all model-invocable skills (including non-user-invocable ones), and reserve user-invocable filtering for the slash-command UI.
- Glob patterns ending in `**` (for example `"**"` or `"src/**"`) should be treated as recursive, even when `**` is the final segment.
- In shell tools, avoid piping primary command output directly to `head` when exit-code handling matters; pipeline semantics can mask real failures from the primary command.
- Bash approval heuristics should reserve prompts for clearly destructive commands (for example `rm -rf`, `sudo`, or mutating git/package-manager operations); treating pipes/chaining and common filesystem reads as dangerous creates too many false-positive approvals for normal inspection commands.
- Verification instructions must tell the agent to consult AGENTS.md / `package.json` scripts **before** listing generic steps like "typecheck -> lint -> build"; otherwise models default to raw commands (`npx tsc`, `eslint .`) which bypass project-specific tool config (turbo pipelines, tsconfig references, ultracite, etc.) and produce incorrect or incomplete results.
- Tool renderer `part.output` values may be `unknown`; when accessing fields like `files` or `matches`, add runtime narrowing/type guards first (in both TUI and web renderers) to satisfy strict typecheck.
- AI SDK stream handles may return `PromiseLike` values (not full `Promise`), so avoid methods like `.finally()` and use `then`/`catch` patterns that work with `PromiseLike`.
- After schema edits, review generated Drizzle migrations for unrelated schema drift changes before committing (for example defaults on untouched columns), since `drizzle-kit generate` can include those alongside intended changes.
- `bunx @vercel/config validate` executes the CLI under Node via its shebang and cannot parse TypeScript-style `vercel.ts` imports; use `bunx --bun @vercel/config validate` (or `bun node_modules/@vercel/config/dist/cli.js validate`) for reliable local validation.
- Successful Vercel CLI auth (`vercel whoami`, team/project REST APIs, `.vercel` linking) does **not** guarantee Workflow observability access. `workflow inspect ... --backend vercel` can still fail with `401 {"error":{"code":"unauthorized","message":"You are not allowed to access this endpoint."}}` when the user/token lacks the Vercel product permission documented as `Vercel Workflow` (and possibly related Observability access), even if `WORKFLOW_VERCEL_AUTH_TOKEN` is passed explicitly from the Vercel CLI auth file.

## Next.js

- In Next.js App Router, dynamic route param names must match the folder segment exactly (e.g. `[sessionId]` requires `params.sessionId`, not `params.id`), or DB queries can receive `undefined` and fail at runtime.
- Some planning docs still reference legacy `apps/web/app/tasks/[id]/...` paths; current UI/API code is centered on `apps/web/app/sessions/[sessionId]/chats/[chatId]/...`, so verify file paths before implementing plan items.
- Next.js `after()` defers callbacks until the response is fully sent; for streaming endpoints this means `after()` runs after the entire stream completes, not at call time. Use fire-and-forget (`void run()`) for lifecycle kicks that must happen at request start.
- In Next.js Route Handlers, `cookies()` from `next/headers` combined with `Response.redirect()` silently drops Set-Cookie headers from the redirect response. Use `NextResponse.redirect()` with `response.cookies.set()` instead to ensure cookies are included in redirect responses.
- In this codebase's Next.js version, `revalidateTag` must be called with a second argument (for example `{ expire: 0 }`); single-argument calls fail typecheck.
- For Workflow SDK discovery in Next.js, ensure workflow files live in scanned directories (for this app, `app/`), otherwise manifests can show steps but `0 workflows` and `start()` will not run durable workflows.
- Server-side optimistic chat route lookup must allow realistic persistence latency (multi-second retry window), otherwise `/sessions/[sessionId]/chats/[chatId]` can redirect away before chat creation finishes.

## Sandbox Lifecycle

- Detached/background bash results may have `exitCode: null` for both successful starts and explicit tool failures; bash renderer error state must also honor `output.success === false` (not only numeric non-zero exit codes), and detached quick-failure probing should prefer a timer-vs-wait race branch over matching SDK-specific error names.
- Creating a sandbox snapshot automatically shuts down that sandbox; lifecycle plans and implementations must treat snapshotting as a stop/hibernate transition, not a non-disruptive backup.
- Vercel `sdk.domain(port)` throws when a sandbox has no route for that port (common on some restored/reconnected sandboxes); environment/prompt metadata should guard per-port URL generation instead of assuming every configured port is routable.
- Vercel sandbox creation has a hard timeout limit of `18_000_000ms`; if you add an internal timeout buffer before calling the SDK, clamp proactive timeout so `timeout + buffer` never exceeds that API limit.
- In serverless environments, lifecycle checks that only run inline during request handlers are not durable; long-gap sandbox lifecycle actions must be scheduled with a durable workflow run (`start(...)` + `sleep(...)`) so they execute without a connected client.
- Vercel `snapshot()` may return `422 sandbox_snapshotting` when another snapshot is already in progress; lifecycle code should treat this as an idempotent/in-progress condition and reconcile state instead of marking lifecycle as failed.
- The reconnect API can return `expired` when a sandbox has already stopped; client reconnection state should treat `expired` like `no_sandbox` so restore UX does not get stuck in a generic failure path.
- For workflow-managed sandbox lifecycle, avoid client-side timeout auto-stop logic in the chat UI; it can race with workflow hibernate and produce confusing paused overlays while the tab remains open.
- Snapshot restore should be idempotent when a sandbox is already running: return success with an `alreadyRunning` signal instead of a 400, and let the client reconnect/sync rather than surfacing a hard error.
- For lifecycle workflow kicks in request handlers, call `kickSandboxLifecycleWorkflow(...)` directly instead of wrapping it in `after(...)`; delayed/deferred scheduling can miss the initial hibernation timer for idle sessions.
- For sandbox lifecycle kicks, do not persist `lifecycleRunId` before `start(...)`; start first and let the durable workflow claim/verify the lease so canceled fire-and-forget kicks cannot strand a stale lease.
- Lifecycle workflow must retry after a `skipped/not-due-yet` evaluation; without retry the sandbox never hibernates unless a new event kicks a fresh workflow.
- When the lifecycle workflow inline fallback runs (SDK unavailable), it evaluates immediately and skips because the sandbox isn't due yet; the status endpoint should detect overdue `hibernateAfter` and kick the lifecycle as a safety net.

## Sandbox UI State

- Status chips that derive from time-based sandbox validity should not rely on memoization without a time dependency; otherwise header state can drift from overlay/input state as `Date.now()` changes.
- Keep sandbox status UI elements (chip, overlay, and indicator dot) on a shared `isSandboxActive` source; mixed heuristics (e.g., one using grace-window validity and another using raw countdown) can show contradictory states like `Paused` with a green dot.
- Treat `/api/sandbox/reconnect` as a read-only status probe; reconnect polling should never refresh lifecycle activity timestamps or kick lifecycle workflows, or idle sessions can fail to hibernate correctly.
- For paused sessions, auto-resume on entry should trigger only after reconnect confirms `no_sandbox`; do not auto-restore on generic reconnect failures.
- Do not use `snapshotUrl` alone to infer paused/hibernating UI state; active sessions may retain a snapshot reference. Require absence of runtime sandbox state (`sandboxId`/`files`) before labeling hibernation.
- Keep sandbox mode details out of page/presentation components: expose capability flags (for example `supportsDiff`, `supportsRepoCreation`, `hasRuntimeSandboxState`) from shared context and branch UI on capabilities, not raw `sandboxState.type`.
- Auto-resume-on-entry for paused sessions must not require a prior `no_sandbox` reconnect result when there is no runtime sandbox state in DB; snapshot-only sessions can otherwise get stuck in `idle` and never restore.
- For predictive lifecycle UI countdowns, use server-provided timestamps (`hibernateAfter`, `sandboxExpiresAt`) plus a server-time offset from reconnect responses; do not rely on client clock alone for transition timing.
- Auto-resume for paused sessions must run only on initial session entry; once a tab has had an active sandbox, do not auto-resume after a later inactivity hibernate in that same tab.
- Keep the sandbox indicator dot on the same derived lifecycle state machine as the status chip; during inactivity countdown it should show a pausing state, and during server `hibernating` it should not remain green.
- Split lifecycle UI polling from connectivity probing: poll a lightweight DB-backed sandbox status endpoint for timing/state, and reserve reconnect/connect checks for entry/resume or explicit recovery paths.
- Prefer event-first lifecycle sync in the chat UI (chat completion, visibility return, window focus, network online), with sparse status polling (about 60s baseline, tighter only near transitions) instead of frequent fixed-interval polling.
- When syncing status timestamps, avoid rewriting sandbox connection state on every response; only update if expiry materially changes, or UI effects can enter rapid request loops.
- Resume/paused UI must not rely only on `session.snapshotUrl` from initial page props; keep a live `hasSnapshot` signal from reconnect/status responses, or the UI can incorrectly show `No sandbox` and hide resume actions.
- `/api/sandbox/reconnect` should treat DB runtime state (`sandboxId`/`files`) as the source of reconnect eligibility; using `isSandboxActive` (which includes expiry heuristics) can misclassify recoverable sessions as `no_sandbox` and break restore/reconnect flows.
- When `/api/sandbox/reconnect` reports `connected`, it must persist refreshed sandbox runtime state/expiry (`sandboxState`, `sandboxExpiresAt`) back to DB; otherwise `/files` and `/diff` can still fail with `Sandbox not initialized` against stale expired state while UI thinks reconnect succeeded.
- For sandbox lifecycle UI, keep the client simple and server-authoritative: poll `/api/sandbox/status` on a fixed cadence (currently 15s) instead of combining multiple client-side event/predictive sync paths, which can drift or loop under reconnect/hibernation edge cases.
- Reconnect liveness probes can time out right after snapshot restore while the sandbox is still starting; treat probe timeouts as transient (non-terminal) and clear runtime state only for hard unavailability signals (stopped/not found/stream unavailable).
- Keep `/api/sandbox/status` as a DB-backed read-only view; do not mutate/clear sandbox runtime state from status polling, or active sessions can be downgraded to `no_sandbox` and later restore from stale snapshots.
- On Vercel reconnect (`state.sandboxId`), do not pass `remainingTimeout=0` from stale `state.expiresAt`; that creates an immediately-expired local wrapper and can make the header/API checks flip to `No sandbox` even while the VM is reachable.
- Reconnect success should refresh full active lifecycle timestamps (`lastActivityAt`, `hibernateAfter`, `sandboxExpiresAt`) before responding; otherwise UI status chips can stay stuck in `Pausing` from stale lifecycle fields.
- Lifecycle countdown UI windows should scale with configured inactivity timeout; fixed windows (for example 2 minutes) can make short test timeouts (for example 1 minute) appear to be perpetually pausing.
- Reconnect can return a sandbox handle whose command stream is unusable (`Expected a stream of command data`); reconnect should probe command execution before declaring `connected`, and file/diff routes should treat that error as sandbox-unavailable (hibernated) rather than a git-repo error.
- Archive uses a deferred background snapshot; if unarchive runs before `snapshotUrl` is persisted, resume/restore can race with `no_snapshot`, so unarchive/restore flows must gate on snapshot readiness (or surface a clear snapshot-in-progress state).
- Client UI `sandboxUiStatus` must check server `lifecycleTiming.state` (from status poll) as primary source, not only local `sandboxInfo`; otherwise UI stays "Active" after server-side hibernation until the local timeout expires or user refreshes.
- The `isSandboxActive` client flag must incorporate `lifecycleTiming.state`; local `isSandboxValid(sandboxInfo)` alone is insufficient because the server can hibernate the sandbox while the local timeout is still valid.
- In the sandbox lifecycle evaluator, treat any non-null chat `activeStreamId` as an authoritative no-hibernate signal; do not inspect workflow status or clear stream ids from the lifecycle path, and recheck immediately before snapshotting to avoid racing a newly-started stream.

## Chat / Streaming UI

- In large chat/page client components, extract new feature-specific UI flows into colocated hooks and child components instead of adding more state/effects/handlers inline; if the feature state must survive dropdown/popover/dialog toggles, mount the hook in the parent view and pass its controls down.
- In the web chat UI, do not keep `@ai-sdk/react` Chat instances alive after route transitions while they are still streaming; abort local stream processing and remove the instance on teardown, then rely on resumable stream reconnect when revisiting that chat.
- For client-side tool flows (`ask_user_question`), `onFinish`-only assistant persistence is insufficient across route switches: persist the latest incoming message snapshot at API request start (upsert by message id) so answered/declined tool state survives teardown/resume and does not rehydrate stale `input-available` UI.
- Request-start assistant snapshot persistence must be scoped and ownership-guarded: only upsert assistant messages when the request still owns the chat stream token, and refuse upserts on message-id scope conflict (different chat/role) to prevent stale writes and cross-chat overwrites.
- Keep `activeStreamId` resumable at all times: do not publish pre-registration ownership placeholders to `activeStreamId` (resume probes can clear them as stale), and gate `onFinish` writes on the atomic compare-and-set result that clears the currently owned token.
- Usage analytics `messageCount` must represent assistant turns, not raw `usage_events` rows; when subagent/model breakdown rows are recorded, count only canonical main-agent rows in additive rollups to avoid inflated totals and heatmaps.
- Unread correctness depends on visibility-aware read receipts and insert-only assistant activity updates: block read receipts for hidden tabs, but allow forced read marks on visible tabs without waiting for focus; only advance `lastAssistantMessageAt` when an assistant message upsert actually inserts a new row (not snapshot/tool-result updates).
- Post-turn automations that must happen even after the user leaves the chat (for example auto-commit/push) should be scheduled from the server chat completion path, not only from client `status === "ready"` effects; client-only hooks can miss turns that finish while the page is closed and can lag behind background completion.
- Chat list streaming indicators should poll more frequently while any chat is actively streaming (for example ~1s) and fall back to a slower cadence when idle, to avoid delayed white-to-complete indicator transitions after chat switches.
- Sidebar chat lists should hydrate from server-fetched initial chat summaries (layout props) in addition to SWR fetches, so transient `/api/sessions/[sessionId]/chats` failures do not render an empty list on hard refresh.
- For hydration-sensitive SWR endpoints (notably sidebar chat lists), use a dedicated `no-store` fetcher instead of changing the shared SWR fetcher globally; otherwise browser HTTP caching gets disabled across unrelated `/api` hooks (models, branches, repos, settings).
- Optimistic chat-title previews for `"New chat"` must have an explicit rollback on send failures; otherwise the sidebar can keep a title that was never persisted if the first request errors.
- `hadInitialMessages` is an initial-load snapshot, not a live "first turn" signal; guard one-time optimistic UI (like first-message title previews) with a dedicated runtime ref/state that resets on send failure.
- When session overlay maps are deleted after becoming empty, any later overlay writes in the same hook instance must re-register the map in the global registry, or optimistic overlays will not survive route transitions.
- For resumed chat streams, `chat.stop()` alone is insufficient because reconnect fetches are not wired to the active abort signal; always pair stop with aborting the managed transport tied to that chat instance.
- Automatic stream retries should use soft reconnect semantics and single-flight guards; overlapping hard retries can replay resumable chunks and cause visible reasoning/tool UI flicker.
- In chat UI rendering, treat both `submitted` and `streaming` as in-flight. If only `streaming` is considered active, task/tool parts can be marked interrupted too early and stale `Thinking...` indicators can linger until a full page refresh.
- In Streamdown, `plugins.code.getThemes()` overrides the `shikiTheme` prop; configure code themes in `createCodePlugin(...)` and pass actual custom theme objects for non-bundled themes (for example `vercelLight`/`vercelDark`) or highlighting can fall back to unstyled/plain tokens.
- Shiki dual-theme `TokensResult` can encode dark variants inside semicolon-delimited `fg`/`bg` values and token `htmlStyle` fields (for example `color` + `--shiki-dark`); normalize these into Streamdown's `color`/`bgColor` fields plus root CSS vars, or inline light colors can override dark-mode classes and keep code blocks stuck in light theme.

## GitHub App / PR Flows

- GitHub App install flow uses a three-path strategy: (1) no linked account -- OAuth authorize URL with explicit `redirect_uri`, callback chains to install with `target_id`; (2) linked account but no installations -- `installations/new/permissions?target_id={githubId}` directly; (3) linked account with installations -- `select_target` for the account/org picker. Disable "Request user authorization (OAuth) during installation" on the GitHub App -- it causes auto-redirect loops for already-authorized users on both `select_target` and `installations/new/permissions`.
- GitHub App must be made **public** for the org picker to appear during installation. While the app is private, `/installations/select_target` only shows the owner's personal account -- users cannot install on organizations. Use "Make public" in the GitHub App's Danger Zone when ready.
- Use `/installations/select_target` instead of `/installations/new` for the GitHub App install URL; the latter silently redirects to an existing personal installation's settings page instead of showing the account/org picker.
- GitHub App callbacks that process OAuth `code` or `installation_id` must validate a server-stored `state` nonce before linking accounts or syncing installations; never trust callback query params without CSRF/state verification.
- Installation sync that prunes DB records must fetch all GitHub API pages first (`per_page=100` + pagination); pruning from a partial page can silently remove valid installations.
- In the GitHub App install flow, do a user-token installation sync before redirecting after OAuth-only callbacks or treating zero local installation rows as "not installed"; GitHub can skip callback emissions for pre-existing installs.
- Public upstream repositories may reject direct branch pushes; PR generation should fall back to creating/pushing to the user's fork and PR creation must use a qualified head ref (`forkOwner:branch`).
- GitHub fork creation can take longer than a few seconds to become pushable; PR fallback should retry fork push on transient `repository not found` errors instead of failing immediately.
- Git push failures from Vercel sandboxes can return empty output even when auth/write is denied; PR fallback logic should not rely only on matching "permission" text before attempting fork fallback.
- GitHub App user/integration tokens may return `403 Resource not accessible by integration` for fork creation; PR fallback should surface a manual-fork guidance path instead of assuming automatic fork creation is always allowed.
- For PR/push flows, installation tokens can fail on repos outside selected installation scope even when the user's GitHub token has write access; retry origin push/PR creation with user token before forcing fork fallback.
- Even when branch push succeeds, GitHub PR creation can still return `403 Resource not accessible by integration`; expose a compare URL fallback so users can complete PR creation manually in the browser.
- For manual compare fallback, include `title` and `body` query params on the GitHub compare URL so PR details are prefilled when API creation is unavailable.
- Preserve fork PR metadata across retries: if a branch already tracks `fork/<branch>` and no new push is needed, derive and return `prHeadOwner` from fork upstream/remote state so later PR creation still uses a qualified head ref.
