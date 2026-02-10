import { cookies } from "next/headers";
import { encrypt } from "@/lib/crypto";
import { upsertGitHubAccount } from "@/lib/db/accounts";
import { syncUserInstallations } from "@/lib/github/installations-sync";
import { getServerSession } from "@/lib/session/get-server-session";

interface GitHubUser {
  id: number;
  login: string;
}

function parseInstallationId(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const installationId = Number.parseInt(value, 10);
  if (!Number.isFinite(installationId)) {
    return null;
  }

  return installationId;
}

function sanitizeRedirectTo(rawRedirectTo: string | null | undefined): string {
  if (!rawRedirectTo) {
    return "/settings/accounts";
  }

  if (!rawRedirectTo.startsWith("/") || rawRedirectTo.startsWith("//")) {
    return "/settings/accounts";
  }

  return rawRedirectTo;
}

/**
 * Exchange an OAuth authorization code for an access token and link the
 * GitHub account to the current user. This handles the `code` parameter
 * that GitHub sends when "Request user authorization (OAuth) during
 * installation" is enabled on the GitHub App.
 *
 * Returns the access token on success, or null if the exchange fails.
 */
async function exchangeOAuthCode(
  code: string,
  userId: string,
): Promise<string | null> {
  const clientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("GitHub OAuth not configured (missing client ID or secret)");
    return null;
  }

  try {
    const tokenResponse = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
      },
    );

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      scope?: string;
      error_description?: string;
    };

    if (!tokenData.access_token) {
      console.error(
        "OAuth token exchange failed:",
        tokenData.error_description ?? "no access_token in response",
      );
      return null;
    }

    // Fetch the GitHub user profile to link the account
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!userResponse.ok) {
      console.error("Failed to fetch GitHub user during OAuth exchange");
      return null;
    }

    const githubUser = (await userResponse.json()) as GitHubUser;

    await upsertGitHubAccount({
      userId,
      externalUserId: `${githubUser.id}`,
      accessToken: encrypt(tokenData.access_token),
      scope: tokenData.scope,
      username: githubUser.login,
    });

    return tokenData.access_token;
  } catch (error) {
    console.error("OAuth code exchange error:", error);
    return null;
  }
}

export async function GET(req: Request): Promise<Response> {
  const requestUrl = new URL(req.url);
  const cookieStore = await cookies();
  const redirectTo = sanitizeRedirectTo(
    cookieStore.get("github_app_install_redirect_to")?.value,
  );

  const session = await getServerSession();
  if (!session?.user?.id) {
    const signinUrl = new URL("/api/auth/signin/vercel", req.url);
    signinUrl.searchParams.set(
      "next",
      `${requestUrl.pathname}${requestUrl.search}`,
    );
    return Response.redirect(signinUrl);
  }

  const redirectUrl = new URL(redirectTo, req.url);
  const installationId = parseInstallationId(
    requestUrl.searchParams.get("installation_id"),
  );
  const oauthCode = requestUrl.searchParams.get("code");
  const callbackState = requestUrl.searchParams.get("state");
  const expectedState = cookieStore.get("github_app_install_state")?.value;

  if (
    (oauthCode || installationId) &&
    (!callbackState || !expectedState || callbackState !== expectedState)
  ) {
    cookieStore.delete("github_app_install_redirect_to");
    cookieStore.delete("github_app_install_state");
    redirectUrl.searchParams.set("github", "invalid_state");
    return Response.redirect(redirectUrl);
  }

  // ── Step 1: Handle OAuth code if present ──────────────────────────────
  // When "Request user authorization (OAuth) during installation" is enabled
  // on the GitHub App, GitHub sends a `code` alongside `installation_id`.
  // Exchange it for a user token and link the GitHub account in one step.
  let userToken: string | null = null;

  if (oauthCode) {
    userToken = await exchangeOAuthCode(oauthCode, session.user.id);
  }

  // ── Step 2: Sync installations from user-scoped data ──────────────────
  let synced = false;

  // Prefer the freshly-obtained token; fall back to an existing stored token
  const tokenForSync =
    userToken ?? (await import("@/lib/github/user-token")).getUserGitHubToken();
  const resolvedToken =
    typeof tokenForSync === "string" ? tokenForSync : await tokenForSync;

  if (resolvedToken) {
    try {
      await syncUserInstallations(session.user.id, resolvedToken);
      synced = true;
    } catch (error) {
      console.error("Failed syncing installations from user token:", error);
    }
  }

  // ── Step 3: Determine result status ───────────────────────────────────
  // GitHub sends setup_action=install|update|request to indicate what happened
  const setupAction = requestUrl.searchParams.get("setup_action");

  let githubStatus: string;
  if (synced && setupAction === "request") {
    githubStatus = "request_sent";
  } else if (synced) {
    githubStatus = "connected";
  } else if (!installationId) {
    githubStatus = "no_action";
  } else {
    githubStatus = "pending_sync";
  }

  redirectUrl.searchParams.set("github", githubStatus);
  if (!installationId) {
    redirectUrl.searchParams.set("missing_installation_id", "1");
  }

  cookieStore.delete("github_app_install_redirect_to");
  cookieStore.delete("github_app_install_state");

  return Response.redirect(redirectUrl);
}
