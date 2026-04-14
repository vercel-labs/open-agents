Summary: Replace `getRepoToken`-based auth in GitHub user actions with the GitHub OAuth user token helper and update all callsites so user-triggered actions are always performed as the user.

Context: `apps/web/lib/github/get-repo-token.ts` currently prefers installation tokens, which causes user-triggered clone/setup, commit/push, PR, merge/close, checks/log reads, repo listing/branch listing, and create-repo flows to act via the app installation. The codebase already has `getUserGitHubToken` in `apps/web/lib/github/user-token.ts`, including refresh support, so the smallest coherent fix is to make user-action boundaries call that helper directly.

System Impact: The source of truth for GitHub auth in user actions becomes the linked OAuth token from `apps/web/lib/github/user-token.ts`. Installation-token auth is removed from these user-action paths, so action attribution and permissions follow the linked user account consistently.

Approach: Replace production `getRepoToken` usages with `getUserGitHubToken`, preserving existing error/public fallback behavior where applicable. Update the create-repo flow to create and push with the same OAuth token. Remove the now-obsolete `getRepoToken` helper once no production code depends on it.

Changes:
- `apps/web/app/[username]/[repo]/page.tsx` - use `getUserGitHubToken` for authenticated repo lookup.
- `apps/web/app/api/check-pr/route.ts` - read PR state with OAuth token.
- `apps/web/app/api/generate-pr/route.ts` - set remote auth, push, fork fallback, and PR generation around OAuth token only.
- `apps/web/app/api/github/branches/route.ts` - fetch private branches with OAuth token; retain unauthenticated public fallback.
- `apps/web/app/api/github/repos/route.ts` - fetch repositories with OAuth token only.
- `apps/web/app/api/github/create-repo/route.ts` - create repos with OAuth token and resolve owner/account type without installation-token auth.
- `apps/web/app/api/pr/route.ts` - create PRs and enable auto-merge with OAuth token.
- `apps/web/app/api/sessions/[sessionId]/checks/fix/route.ts` - fetch Actions logs with OAuth token.
- `apps/web/app/api/sessions/[sessionId]/close-pr/route.ts` - close PR with OAuth token.
- `apps/web/app/api/sessions/[sessionId]/merge-readiness/route.ts` - read merge readiness/checks with OAuth token.
- `apps/web/app/api/sessions/[sessionId]/merge/route.ts` - merge/delete branch with OAuth token.
- `apps/web/app/api/sessions/[sessionId]/pr-deployment/route.ts` - read deployment metadata with OAuth token.
- `apps/web/lib/chat/auto-commit-direct.ts` - push with OAuth token.
- `apps/web/lib/chat/auto-pr-direct.ts` - use OAuth token for repo reads and PR creation.
- `apps/web/lib/github/get-repo-token.ts` and tests - remove if unused after migration.
- Affected tests under `apps/web/app/api/**` and `apps/web/lib/**` - update mocks/expectations to use `getUserGitHubToken`.

Verification:
- Run `bun run check`
- Run `bun run typecheck`
- Run targeted isolated tests for updated modules
- Run `bun run ci`
- Edge cases: missing/expired OAuth token, public repo lookup fallback, org repo creation via OAuth token, fork PR flows, merge/close permissions, Actions log access.
