Summary: Rework deployment guidance around the app’s current codepath, then add a repo-local `deploy-open-harness` skill that walks an agent and user through collecting only the credentials actually required today, deploying this repo on Vercel, and completing first-run setup.

Context:
- The earlier setup guidance is partly inherited from older Harness-era assumptions. The current source of truth is the live code in `apps/web`, not the existing setup docs.
- Current runtime audit shows the hard requirements and feature gates are narrower than the old setup flow suggests:
  - baseline runtime requires `POSTGRES_URL` and `JWE_SECRET`
  - usable sign-in on a self-hosted deployment also requires Vercel OAuth (`NEXT_PUBLIC_VERCEL_APP_CLIENT_ID`, `VERCEL_APP_CLIENT_SECRET`) and token encryption (`ENCRYPTION_KEY`)
  - GitHub repo access requires GitHub OAuth + GitHub App vars
  - Redis is optional and feature-gated via `REDIS_URL`/`KV_URL`
  - `VERCEL_SANDBOX_BASE_SNAPSHOT_ID` and production URL vars are optional deployment refinements
- `NEXT_PUBLIC_AUTH_PROVIDERS` appears unused in the current app and should not be presented as a required setup knob.
- `scripts/setup.sh` is stale/incomplete for current needs: it syncs some nonessential vars, but does not ensure `POSTGRES_URL` or `JWE_SECRET`, which are the real hard requirements.
- `.worktree-setup` delegates to `scripts/setup.sh`, so removing the script requires updating that file too.

System Impact:
- This is primarily a guidance/docs/skill change; app runtime behavior stays the same.
- Source of truth for deployment instructions should shift from legacy helper script assumptions to code-derived env requirements.
- If `scripts/setup.sh` is removed, local setup and worktree setup docs must no longer depend on it.
- The new skill becomes the agent-facing orchestration layer for deploy/setup conversations, while `README.md` and `apps/web/.env.example` remain the concise human-readable references.

Approach:
- Create a new local skill at `.agents/skills/deploy-open-harness/SKILL.md` that:
  1. determines whether the user wants a minimal deploy or full GitHub-enabled agent flow,
  2. builds a credential checklist from the current code-derived env requirements,
  3. explains how to obtain each credential without asking users to paste secrets into chat,
  4. guides deployment of this repo on Vercel,
  5. verifies sign-in, session creation, and optional GitHub install after deploy,
  6. ends with next steps for optional upgrades like Redis.
- Update top-level setup docs to match the real current requirements and remove outdated `setup.sh` guidance.
- Remove `scripts/setup.sh` if it no longer provides trustworthy setup behavior, and clean up any references that depend on it.

Changes:
- `.agents/skills/deploy-open-harness/SKILL.md` - new deployment/setup skill grounded in current runtime requirements.
- `README.md` - replace stale setup guidance with current required/optional env vars and a direct deployment flow.
- `apps/web/.env.example` - remove unused or misleading setup notes and keep the env template aligned with actual code usage.
- `.worktree-setup` - remove dependency on `scripts/setup.sh` if the script is deleted.
- `scripts/setup.sh` - remove if it is no longer a reliable setup path.

Verification:
- Run `bun run ci`.
- Manually review the new skill and updated docs against the audited runtime files in `apps/web`.
- Confirm there are no remaining references to `scripts/setup.sh` if it is removed.
- Confirm the documented env list clearly separates:
  - minimum runtime requirements
  - required vars for sign-in and agent flows
  - optional vars and what they enable.