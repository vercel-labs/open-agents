import { connect } from "@vercel/connect/betterauth";
import type { User } from "better-auth";
import type { OAuth2Tokens } from "better-auth/oauth2";
import type { GenericOAuthConfig } from "better-auth/plugins/generic-oauth";
import { deriveAuthUsername } from "@/lib/auth/username";
import { getGitHubConnector } from "@/lib/github/connector";

/**
 * GitHub OAuth provider backed by the Vercel Connect GitHub connector.
 *
 * The OAuth client lives in Vercel Connect (no GitHub client id/secret in the
 * app). The token stored on the account row is a Connect-issued token used
 * only for the link handshake — GitHub API tokens are exchanged at runtime
 * via `getToken` (see `lib/github/token.ts`), keyed by the Connect subject id
 * that better-auth stores as `accounts.accountId`.
 */
export function buildGitHubConnectProvider(): GenericOAuthConfig {
  const base = connect({
    providerId: "github",
    connector: getGitHubConnector(),
  });

  return {
    ...base,
    // Sign-in happens exclusively via Vercel OAuth; GitHub is link-only.
    disableImplicitSignUp: true,
    // Connect's OIDC userinfo can omit email/name when the GitHub account
    // has no public profile data, and generic OAuth aborts the link when
    // either is missing — backfill deterministic values.
    getUserInfo: async (tokens: OAuth2Tokens) => {
      const user = await base.getUserInfo?.(tokens);
      if (!user) {
        return null;
      }
      return {
        ...user,
        name: user.name ?? `github-${user.id}`,
        email: user.email ?? `${user.id}@users.noreply.github.com`,
      };
    },
    mapProfileToUser: (
      profile: Record<string, unknown>,
    ): Partial<User> & { username: string } => ({
      username: deriveAuthUsername(profile),
    }),
  };
}
