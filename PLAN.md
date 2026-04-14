Summary: Switch user-initiated GitHub operations from installation-token-first auth to GitHub OAuth user tokens, while keeping app-installation auth available only for installation-scoped/non-user flows.

Context: `apps/web/lib/github/get-repo-token.ts` currently prefers installation tokens and only falls back to the user OAuth token. That helper is used across PR creation, merge/close, branch/repo lookups, PR checks/deployment/log reads, automated commit/push flows, and repo page/session setup. `apps/web/app/api/github/create-repo/route.ts` and `apps/web/app/api/github/create-repo/_lib/create-repo-workflow.ts` also use installation tokens directly for org repo creation/push. This means many user-triggered actions are currently attributed to the app installation instead of the user. The existing `getUserGitHubToken` helper already provides the right OAuth token source of truth.

System Impact: The source of truth for user actions becomes the linked GitHub OAuth token from `apps/web/lib/github/user-token.ts`. Installation tokens remain available for app-owned/integration-only flows, but user-facing lifecycle actions (repo access during session creation, git remote auth, PR create/close/merge, checks/log reads, repo creation) will stop preferring installation auth. This changes attribution, permissions, and fallback behavior across git/GitHub API calls, and requires tests to assert user-token-first behavior.

Approach: Keep `getRepoToken` for installation-aware/internal callers, but introduce a separate user-action token helper and migrate user-action endpoints/modules to it. This is the smallest coherent change because it avoids breaking installation-specific flows while making the policy explicit at each user action boundary instead of silently changing all existing callers.

Changes:
- `apps/web/lib/github/get-repo-token.ts` - keep current installation-aware helper for non-user flows.
- `apps/web/lib/github/get-user-action-token.ts` (new) - return the OAuth token for a user-triggered GitHub action; throw when unavailable.
- `apps/web/lib/github/get-user-action-token.test.ts` (new) - cover successful OAuth resolution and failure cases.
- `apps/web/app/[username]/[repo]/page.tsx` - use OAuth token for repo lookup during session creation so clone/session setup uses user auth.
- `apps/web/app/api/generate-pr/route.ts` - use OAuth token for origin auth, push, fork fallback, and PR creation instead of installation-first candidate ordering.
- `apps/web/app/api/pr/route.ts` - create PRs with OAuth token(s) only for user-triggered PR creation.
- `apps/web/lib/chat/auto-commit-direct.ts` - set authenticated remote with OAuth token only.
- `apps/web/lib/chat/auto-pr-direct.ts` - use OAuth token for repo reads and PR creation.
- `apps/web/app/api/sessions/[sessionId]/merge/route.ts` - merge/delete branch with OAuth token.
- `apps/web/app/api/sessions/[sessionId]/close-pr/route.ts` - close PR with OAuth token.
- `apps/web/app/api/check-pr/route.ts` - read PR status with OAuth token.
- `apps/web/app/api/sessions/[sessionId]/merge-readiness/route.ts` - read merge readiness/checks with OAuth token.
- `apps/web/app/api/sessions/[sessionId]/checks/fix/route.ts` - download Actions logs with OAuth token.
- `apps/web/app/api/sessions/[sessionId]/pr-deployment/route.ts` - read PR deployment/check metadata with OAuth token.
- `apps/web/app/api/github/branches/route.ts` - fetch private branches with OAuth token; retain public fallback.
- `apps/web/app/api/github/repos/route.ts` and `apps/web/lib/github/installation-repos.ts` - stop using installation-repository listing for user-driven repo selection; fetch via OAuth token.
- `apps/web/app/api/github/create-repo/route.ts` and `apps/web/app/api/github/create-repo/_lib/create-repo-workflow.ts` - create repo and initial push with OAuth token for both personal and org user actions.
- Affected tests under `apps/web/app/api/**` and `apps/web/lib/**` - update mocks/expectations from installation-first to OAuth-user behavior.

Verification:
- Run `bun run check`
- Run `bun run typecheck`
- Run targeted isolated tests for updated auth/token routes/modules via `bun run test:isolated`
- Run `bun run ci` if targeted checks pass cleanly
- Edge cases: missing OAuth token, expired/refreshed OAuth token, public repo fallbacks, org repo creation with user token, PR creation on fork/upstream repos, merge/close permissions, Actions log access, repo/branch lookup for private org repos.
