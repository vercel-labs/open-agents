import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { encrypt } from "@/lib/crypto";
import { getGitHubAccount, upsertGitHubAccount } from "@/lib/db/accounts";
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
    return "/settings/profile";
  }

  if (!rawRedirectTo.startsWith("/") || rawRedirectTo.startsWith("//")) {
    return "/settings/profile";
  }

  return rawRedirectTo;
}

/**
 * Exchange an OAuth authorization code for an access token and link the
 * GitHub account to the current user.
 *
 * Returns the access token and GitHub user ID on success, or null if the
 * exchange fails.
 */
async function exchangeOAuthCode(
  code: string,
  userId: string,
): Promise<{
  token: string;
  githubUserId: string;
  githubUsername: string;
} | null> {
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
      refresh_token?: string;
      expires_in?: number;
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
      refreshToken: tokenData.refresh_token
        ? encrypt(tokenData.refresh_token)
        : undefined,
      expiresAt: tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000)
        : undefined,
      scope: tokenData.scope,
      username: githubUser.login,
    });

    return {
      token: tokenData.access_token,
      githubUserId: `${githubUser.id}`,
      githubUsername: githubUser.login,
    };
  } catch (error) {
    console.error("OAuth code exchange error:", error);
    return null;
  }
}

/** Create a redirect response that clears the install cookies. */
function redirectAndClearCookies(url: string | URL): NextResponse {
  const response = NextResponse.redirect(url);
  response.cookies.delete("github_app_install_redirect_to");
  response.cookies.delete("github_app_install_state");
  response.cookies.delete("github_reconnect");
  return response;
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
    return NextResponse.redirect(signinUrl);
  }

  const redirectUrl = new URL(redirectTo, req.url);
  const installationId = parseInstallationId(
    requestUrl.searchParams.get("installation_id"),
  );
  const oauthCode = requestUrl.searchParams.get("code");
  const callbackState = requestUrl.searchParams.get("state");
  const setupAction = requestUrl.searchParams.get("setup_action");
  const expectedState = cookieStore.get("github_app_install_state")?.value;

  // State validation: require matching state when an OAuth code is present
  // (CSRF protection for token exchange). For installation-only callbacks
  // (just installation_id, no code), state may be absent.
  const hasOAuthPayload = Boolean(oauthCode);
  const stateValid =
    callbackState && expectedState && callbackState === expectedState;

  if (hasOAuthPayload && !stateValid) {
    redirectUrl.searchParams.set("github", "invalid_state");
    return redirectAndClearCookies(redirectUrl);
  }

  // ── Step 1: Handle OAuth code if present ──────────────────────────────
  // The install route sends users without a linked GitHub account through
  // OAuth first. Exchange the code for a token and link the account.
  let oauthResult: {
    token: string;
    githubUserId: string;
    githubUsername: string;
  } | null = null;

  if (oauthCode) {
    oauthResult = await exchangeOAuthCode(oauthCode, session.user.id);
  }

  // ── Step 2: Sync installations from user-scoped data ──────────────────
  let synced = false;
  let syncedInstallationsCount: number | null = null;

  // Prefer the freshly-obtained token; fall back to an existing stored token
  const tokenForSync =
    oauthResult?.token ??
    (await import("@/lib/github/user-token")).getUserGitHubToken();
  const resolvedToken =
    typeof tokenForSync === "string" ? tokenForSync : await tokenForSync;
  const personalAccountLogin =
    oauthResult?.githubUsername ??
    (await getGitHubAccount(session.user.id))?.username ??
    null;

  if (resolvedToken && personalAccountLogin) {
    try {
      syncedInstallationsCount = await syncUserInstallations(
        session.user.id,
        resolvedToken,
        personalAccountLogin,
      );
      synced = true;
    } catch (error) {
      console.error("Failed syncing installations from user token:", error);
    }
  }

  // ── Step 2b: Chain to install only when OAuth completed and no installs ─
  // If OAuth linked an account and sync already found installations, skip
  // chaining through install to avoid dead-ends where GitHub doesn't emit a
  // second callback for pre-existing installs.
  const hasExistingInstallations =
    syncedInstallationsCount !== null && syncedInstallationsCount > 0;

  if (oauthResult && !installationId && !hasExistingInstallations) {
    const installUrl = new URL("/api/github/app/install", req.url);
    installUrl.searchParams.set("target_id", oauthResult.githubUserId);
    installUrl.searchParams.set("next", redirectTo);
    // Don't clear cookies — the install route will set fresh ones
    return NextResponse.redirect(installUrl);
  }

  // ── Step 3: Determine result status ───────────────────────────────────
  // GitHub sends setup_action=install|update|request to indicate what happened

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
  if (!installationId && !synced) {
    redirectUrl.searchParams.set("missing_installation_id", "1");
  }

  return redirectAndClearCookies(redirectUrl);
}
