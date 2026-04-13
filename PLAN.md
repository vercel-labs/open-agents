Summary: Add a repo-local `deploy-open-harness` skill that guides an agent through scoping a user’s desired deployment, collecting the right credentials without exposing secrets in chat, deploying this exact repo on Vercel, and validating the first-run experience.

Context:
- Skills in this repo are discovered from `.agents/skills/<skill-name>/SKILL.md`, so this can be shipped as a local skill without touching app runtime code.
- The deploy source of truth already exists in `README.md`, `apps/web/.env.example`, and `scripts/setup.sh`.
- Current docs already separate three setup tiers we should preserve in the skill:
  - core app boot: `POSTGRES_URL`, `JWE_SECRET`, `ENCRYPTION_KEY`, Vercel OAuth
  - full coding-agent flow: Vercel project/workflow/sandbox setup plus project-managed env pulled by `scripts/setup.sh`
  - GitHub repo access: GitHub OAuth + GitHub App + webhook secret
- `apps/web/.env.example` includes critical GitHub App details that should be surfaced directly in the skill: callback/setup URL, user-authorization during install, and making the app public for org installs.
- User-confirmed scope: target the recommended Vercel-hosted deployment path for this exact repo, and cover both a minimal deploy and the optional full GitHub-enabled path.

System Impact:
- This is a skill-content addition, not an application behavior change.
- Source of truth remains the existing repo docs and env template; the new skill will orchestrate those sources instead of duplicating product logic elsewhere.
- The new skill will introduce a standard deployment conversation flow for agents: scope -> credential checklist -> credential acquisition guidance -> deploy -> verify -> next steps.
- No new persisted state, runtime interfaces, or dependencies are needed.

Approach:
- Create `.agents/skills/deploy-open-harness/SKILL.md`.
- Structure the skill so the agent:
  1. starts by determining whether the user wants a minimal deploy or the full GitHub-enabled agent flow,
  2. builds a credential matrix grouped by required vs optional services,
  3. explains how to obtain each credential and where it should be stored,
  4. guides the user through the Vercel deployment path for this repo,
  5. walks through post-deploy verification and first-run setup,
  6. finishes with a concise checklist of remaining optional upgrades.
- Keep the instructions procedural and safe: do not ask users to paste secrets into chat; instead direct them to add secrets in Vercel/local env files.
- Reuse exact repo paths and env names from existing docs so the skill remains aligned with the codebase.

Changes:
- `.agents/skills/deploy-open-harness/SKILL.md` - new skill with deployment workflow, credential checklist logic, guidance for Vercel OAuth, GitHub OAuth/App, database/encryption setup, deploy steps, and post-deploy verification.

Verification:
- Run `bun run ci` to ensure the repo still passes its required checks after adding the skill.
- Manually review the skill content against `README.md`, `apps/web/.env.example`, and `scripts/setup.sh` to confirm all env names and setup steps match.
- Confirm the skill clearly distinguishes:
  - minimal deploy vs full GitHub-enabled setup
  - required vs optional credentials
  - where secrets should be stored vs what is safe to discuss in chat.