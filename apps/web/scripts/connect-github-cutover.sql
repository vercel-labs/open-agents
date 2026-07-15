-- One-time cutover script for the GitHub App → Vercel Connect migration.
-- Run MANUALLY against the production database when deploying the Connect
-- switch (intentionally NOT a Drizzle migration, so it never runs
-- unreviewed on a deploy).
--
-- Why: GitHub account rows created by the old GitHub App's OAuth client
-- store the GitHub numeric user id as account_id plus now-dead tokens. The
-- generic OAuth (Vercel Connect) link flow matches accounts by
-- (account_id, provider_id) — with the new Connect subject id these stale
-- rows would never be overwritten on re-link and would keep shadowing the
-- new grant (getUserGitHubToken would keep resolving the dead account).
--
-- github_installations rows reference the old GitHub App's installation ids;
-- they self-heal via syncUserInstallations after users re-link, but clearing
-- them up front makes the reconnect state unambiguous.
--
-- After running this, every user reconnects GitHub through the existing
-- reconnect UI (Settings → Connections, or the get-started flow).

DELETE FROM "accounts" WHERE "provider_id" = 'github';

DELETE FROM "github_installations";
