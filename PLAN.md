Summary: Remove the CLI as a product surface and code path by deleting the `apps/cli` workspace, eliminating web auth/device-flow support for it, and cleaning up build/release/docs references. I also recommend removing the CLI token table and CLI-specific usage split so the web app no longer carries dormant CLI infrastructure.

Context: The CLI currently spans multiple layers: the `apps/cli/` workspace itself; root scripts in `package.json`, `scripts/setup.sh`, `scripts/build-installer.ts`, `scripts/build-release-artifacts.ts`, `scripts/release-local.ts`, `scripts/upload-release-to-blob.ts`, and `installer.config.json`; GitHub workflows `.github/workflows/release.yml` and `.github/workflows/release-all.yml`; and web support in `apps/web/app/api/cli/auth/**`, `apps/web/app/api/ai-proxy/[...path]/route.ts`, `apps/web/lib/db/cli-tokens.ts`, `apps/web/app/settings/tokens*`, `apps/web/hooks/use-cli-tokens.ts`, `apps/web/components/install-command-card.tsx`, `apps/web/app/cli/auth/**`, `apps/web/app/home-page.tsx`, `apps/web/components/auth/signed-out-hero.tsx`, and `apps/web/app/settings/usage-section.tsx`. The database schema in `apps/web/lib/db/schema.ts` still defines `cli_tokens`, so removing CLI support should include a Drizzle migration.

Approach: Treat this as a full product removal, not just deleting `apps/cli`. That keeps the repo internally consistent: no dead web routes, no orphaned settings screens, no installer/release pipeline, and no CLI-only env/config requirements. My recommendation is to fully drop `cli_tokens` and remove CLI-specific UI/copy. For usage analytics, I recommend removing the CLI/web split in the UI and backend types; if you want to preserve historical CLI usage data instead of deleting it, I can keep the legacy rows but stop exposing the split.

Changes:
- `apps/cli/**` - delete the CLI workspace entirely.
- `package.json` - remove CLI and CLI-release scripts, plus CLI-only optional OpenTUI binary dependencies if nothing else uses them.
- `bun.lock` - refresh workspace/dependency lockfile after removing CLI package/deps.
- `README.md`, `AGENTS.md`, `docs/agents/architecture.md` - remove CLI setup/run/architecture references.
- `.github/workflows/release.yml`, `.github/workflows/release-all.yml`, `docs/release.md` - remove CLI release pipeline and docs.
- `scripts/setup.sh`, `scripts/refresh-vercel-token.sh`, `conductor-setup.sh` - stop creating/syncing `apps/cli/.env` and remove CLI instructions.
- `scripts/build-installer.ts`, `scripts/build-release-artifacts.ts`, `scripts/release-local.ts`, `scripts/upload-release-to-blob.ts`, `scripts/install.template.sh`, `installer.config.json`, `apps/web/public/install` - delete installer/release artifacts used only by the CLI.
- `apps/web/lib/db/schema.ts` - remove `cli_tokens`; simplify usage source typing if we fully remove CLI history handling.
- `apps/web/lib/db/cli-tokens.ts` - delete CLI token data layer.
- `apps/web/lib/db/usage.ts` - remove CLI-specific source typing/splitting if we collapse usage to web-only semantics.
- `apps/web/lib/db/migrations/*` - generate a new migration for the schema change (dropping `cli_tokens`, and optionally purging CLI usage rows if we choose that route).
- `apps/web/app/api/cli/auth/**`, `apps/web/app/api/ai-proxy/[...path]/route.ts`, `apps/web/app/api/settings/tokens/**` - delete CLI-only API routes.
- `apps/web/app/cli/auth/**`, `apps/web/app/settings/tokens/page.tsx`, `apps/web/app/settings/tokens-section.tsx`, `apps/web/hooks/use-cli-tokens.ts`, `apps/web/components/install-command-card.tsx` - delete CLI-only pages/components/hooks.
- `apps/web/app/settings/layout.tsx`, `apps/web/app/home-page.tsx`, `apps/web/components/auth/signed-out-hero.tsx`, `apps/web/app/settings/usage-section.tsx`, `apps/web/.env.example`, `turbo.json` - remove CLI navigation, banners, hero copy, env vars, and build-time env declarations.

Verification:
- Run `bun install` (to refresh workspace state / lockfile).
- Run `bun run --cwd apps/web db:generate` after updating `schema.ts` and review the generated migration.
- Run `bun run ci` from the repo root.
- Smoke-check the web app: home page, settings navigation, and auth flows should work with no CLI references or broken routes.
- Confirm no remaining live CLI references with targeted searches for `apps/cli`, `/api/cli/auth`, `cli_tokens`, `useCliTokens`, `installer.config.json`, and `bun run cli`.
