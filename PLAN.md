Summary: Add a separate opt-in auto-create-PR flow that runs immediately after the existing auto-commit step in `apps/web/app/workflows/chat.ts`. Reuse the current PR-generation/GitHub logic where possible, keep the workflow orchestration thin, and make PR creation best-effort so chat turns never fail because GitHub PR creation failed.

Context: `apps/web/app/workflows/chat.ts` already triggers `runAutoCommitStep` after a natural finish when `autoCommitEnabled` is passed from `apps/web/app/api/chat/route.ts`. `apps/web/app/workflows/chat-post-finish.ts` wraps that server-side work in a `"use step"` helper, and `apps/web/lib/chat/auto-commit-direct.ts` handles stage/commit/push directly in the sandbox. Manual PR creation is already split into two reusable pieces: `apps/web/app/api/generate-pr/route.ts` generates commit/branch/PR content from sandbox state, and `apps/web/app/api/pr/route.ts` creates the GitHub PR and persists `prNumber` / `prStatus`. Session/UI plumbing already understands PR state through `sessions.prNumber`, `sessions.prStatus`, `/api/check-pr`, and the chat header actions. User preferences and session creation already have an auto-commit default/override path. The main missing pieces are: a distinct auto-PR preference/override, a workflow-side helper that can create/sync a PR without going back through HTTP, and a shared PR-content helper so workflow auto-PR and manual PR generation do not drift.

Approach: Introduce a separate `autoCreatePr` preference plus `autoCreatePrOverride` session field, but only honor it when auto-commit/push is enabled for that session. After a natural chat finish, the workflow should keep its current order: persist -> auto-commit -> auto-create-PR -> refresh diff. The new auto-PR step should: resolve the repo’s default branch, inspect the sandbox’s current branch, skip detached/base-branch/no-remote cases, check GitHub for an existing PR on the branch for idempotency, generate PR title/body from the same extracted helper the manual PR flow uses, create the PR, and persist `prNumber` / `prStatus`. Failures should be logged and swallowed just like auto-commit. For the first implementation, match the current direct auto-commit scope: same repo/origin push flow only, no browser compare-page fallback.

Changes:
- `apps/web/lib/db/schema.ts` - add `autoCreatePrOverride` to `sessions` and `autoCreatePr` to `user_preferences`, then generate the matching Drizzle migration.
- `apps/web/lib/db/user-preferences.ts` - add the new preference to defaults, normalization, and create/update paths.
- `apps/web/lib/db/user-preferences.test.ts` - cover defaulting and round-tripping the new preference.
- `apps/web/app/api/settings/preferences/route.ts` - validate and persist `autoCreatePr` alongside `autoCommitPush`.
- `apps/web/app/api/settings/preferences/route.test.ts` - add request/response coverage for the new preference field.
- `apps/web/hooks/use-user-preferences.ts` - expose `autoCreatePr` to the client.
- `apps/web/app/settings/preferences-section.tsx` - add an “Auto create pull request” toggle, disabled unless auto commit/push is enabled.
- `apps/web/app/api/sessions/route.ts` - accept/store `autoCreatePr` when creating sessions, defaulting from user preferences.
- `apps/web/hooks/use-sessions.ts` - include the new field in session-create payloads.
- `apps/web/components/session-starter.tsx` - add a session-level override toggle for auto PR creation, gated behind the auto-commit toggle.
- `apps/web/components/new-session-dialog.tsx` - thread the new session-create input shape through.
- `apps/web/app/home-page.tsx` - pass the new session-create field through to `createSession`.
- `apps/web/app/[username]/[repo]/page.tsx` - seed repo-launched sessions from the user’s `autoCreatePr` preference.
- `apps/web/app/api/sessions/route.test.ts` - cover session creation persisting the new override.
- `apps/web/app/api/chat/route.ts` - compute `shouldAutoCreatePr` from session override/user preference and pass it into workflow options only for repo-backed sessions.
- `apps/web/app/api/chat/route.test.ts` - verify workflow start options include/exclude the new auto-PR flag correctly.
- `apps/web/app/workflows/chat.ts` - add `autoCreatePrEnabled` to workflow options and call a new post-finish step after auto-commit on natural finishes.
- `apps/web/app/workflows/chat.test.ts` - verify the new step runs only when enabled and the repo context is present.
- `apps/web/app/workflows/chat-post-finish.ts` - add `runAutoCreatePrStep`, mirroring `runAutoCommitStep`.
- `apps/web/app/workflows/chat-post-finish.test.ts` - cover the new step’s connect/call/error-swallow behavior.
- `apps/web/lib/chat/auto-pr-direct.ts` (new) - implement workflow-side PR creation: resolve default branch, inspect current branch/upstream state, reuse shared PR-content generation, create or sync the PR, and update the session record.
- `apps/web/lib/chat/auto-pr-direct.test.ts` (new) - cover skip cases, successful creation, and idempotent “PR already exists” behavior.
- `apps/web/app/api/generate-pr/route.ts` - extract the diff/commit-log/AI PR-content generation block into a shared helper instead of keeping it inline.
- `apps/web/lib/git/pr-content.ts` (new, or similar colocated helper) - hold the shared sandbox diff/log + AI PR-title/body generation logic used by both manual PR generation and workflow auto-PR.

Verification:
- How to test end-to-end:
  - Create a repo-backed session with auto commit on and auto PR off; complete a chat turn that changes files and confirm only commit/push happens.
  - Create a repo-backed session with both auto commit and auto PR on; complete a chat turn that changes files on a non-default branch and confirm a PR is created and `prNumber` / `prStatus` appear in the session header after the usual refresh.
  - Repeat another turn on the same branch and confirm the existing PR is reused instead of creating a second PR.
  - Verify base-branch or detached-HEAD sessions do not auto-open PRs.
- Relevant test commands:
  - `bun test apps/web/app/api/settings/preferences/route.test.ts`
  - `bun test apps/web/app/api/sessions/route.test.ts`
  - `bun test apps/web/app/api/chat/route.test.ts`
  - `bun test apps/web/app/workflows/chat.test.ts`
  - `bun test apps/web/app/workflows/chat-post-finish.test.ts`
  - `bun test apps/web/lib/db/user-preferences.test.ts`
  - `bun test apps/web/lib/chat/auto-pr-direct.test.ts`
  - `bun run ci`
- Edge cases to check:
  - auto PR is ignored when auto commit/push is disabled
  - auto PR is skipped when the current branch matches the repo default branch or has no remote branch to PR from
  - an existing PR on the branch is synced instead of duplicated
  - PR creation failures do not interrupt message persistence, diff refresh, or stream cleanup
