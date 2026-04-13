import { generateState } from "arctic";
import { NextResponse, type NextRequest } from "next/server";
import { getGitHubAccount } from "@/lib/db/accounts";
import { getInstallationsByUserId } from "@/lib/db/installations";
import { decrypt } from "@/lib/crypto";
import { syncUserInstallations } from "@/lib/github/installations-sync";
import { getServerSession } from "@/lib/session/get-server-session";

function sanitizeRedirectTo(rawRedirectTo: string | null): string {
  if (!rawRedirectTo) {
    return "/settings/profile";
  }

  if (!rawRedirectTo.startsWith("/") || rawRedirectTo.startsWith("//")) {
    return "/settings/profile";
  }

  return rawRedirectTo;
}

const COOKIE_OPTIONS = {
  path: "/",
  secure: process.env.NODE_ENV === "production",
  httpOnly: true,
  maxAge: 60 * 15,
  sameSite: "lax" as const,
};

function shouldForceReconnect(req: NextRequest): boolean {
  return (
    req.nextUrl.searchParams.get("reconnect") === "1" ||
    req.cookies.get("github_reconnect")?.value === "1"
  );
}

/**
 * Create a redirect response with install cookies set directly on it.
 * Using NextResponse.redirect() + response.cookies.set() ensures cookies
 * are actually included in the redirect response headers.
 */
function redirectWithInstallCookies(
  url: string | URL,
  redirectTo: string,
  state: string,
): NextResponse {
  const response = NextResponse.redirect(url);
  response.cookies.set(
    "github_app_install_redirect_to",
    redirectTo,
    COOKIE_OPTIONS,
  );
  response.cookies.set("github_app_install_state", state, COOKIE_OPTIONS);
  return response;
}

export async function GET(req: NextRequest): Promise<Response> {
  const session = await getServerSession();

  const redirectTo = sanitizeRedirectTo(req.nextUrl.searchParams.get("next"));

  if (!session?.user?.id) {
    const signinUrl = new URL("/api/auth/signin/vercel", req.url);
    signinUrl.searchParams.set(
      "next",
      `${req.nextUrl.pathname}${req.nextUrl.search}`,
    );
    return NextResponse.redirect(signinUrl);
  }

  const appSlug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;
  if (!appSlug) {
    const fallbackUrl = new URL(redirectTo, req.url);
    fallbackUrl.searchParams.set("github", "app_not_configured");
    return NextResponse.redirect(fallbackUrl);
  }

  const state = generateState();

  // When a specific target_id is provided (numeric GitHub account/org ID),
  // the user already has a linked GitHub account and wants to install the app
  // on a particular account/org. Send them to the GitHub App install page.
  const targetId = req.nextUrl.searchParams.get("target_id");
  if (targetId && /^\d+$/.test(targetId)) {
    const installUrl = new URL(
      `https://github.com/apps/${appSlug}/installations/new/permissions`,
    );
    installUrl.searchParams.set("state", state);
    installUrl.searchParams.set("target_id", targetId);
    return redirectWithInstallCookies(installUrl, redirectTo, state);
  }

  if (shouldForceReconnect(req)) {
    const clientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
    if (clientId) {
      const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
      authorizeUrl.searchParams.set("client_id", clientId);
      authorizeUrl.searchParams.set("state", state);
      const callbackUrl = new URL("/api/github/app/callback", req.url);
      authorizeUrl.searchParams.set("redirect_uri", callbackUrl.toString());
      return redirectWithInstallCookies(authorizeUrl, redirectTo, state);
    }

    const selectTargetUrl = new URL(
      `https://github.com/apps/${appSlug}/installations/select_target`,
    );
    selectTargetUrl.searchParams.set("state", state);
    return redirectWithInstallCookies(selectTargetUrl, redirectTo, state);
  }

  const ghAccount = await getGitHubAccount(session.user.id);
  let installations = ghAccount
    ? await getInstallationsByUserId(session.user.id)
    : [];

  if (ghAccount) {
    if (installations.length === 0) {
      try {
        const userToken = decrypt(ghAccount.accessToken);
        await syncUserInstallations(
          session.user.id,
          userToken,
          ghAccount.username,
        );
        installations = await getInstallationsByUserId(session.user.id);
      } catch (error) {
        console.error("Failed to sync GitHub installations in install flow:", {
          userId: session.user.id,
          error,
        });
      }
    }

    if (installations.length === 0) {
      // Linked account and still no installations after a sync-first refresh.
      // Route to personal-account install for the fastest initial install path.
      const installUrl = new URL(
        `https://github.com/apps/${appSlug}/installations/new/permissions`,
      );
      installUrl.searchParams.set("state", state);
      installUrl.searchParams.set("target_id", ghAccount.externalUserId);
      return redirectWithInstallCookies(installUrl, redirectTo, state);
    }

    // Already has installations — show the account/org picker so they can
    // add the app to additional accounts.
    const installUrl = new URL(
      `https://github.com/apps/${appSlug}/installations/select_target`,
    );
    installUrl.searchParams.set("state", state);
    return redirectWithInstallCookies(installUrl, redirectTo, state);
  }

  // No linked GitHub account — use OAuth to link the account first. The
  // callback will exchange the code, link the account, and then chain to
  // the install flow with the user's GitHub ID as target_id.
  const clientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
  if (!clientId) {
    // No OAuth credentials — fall back to select_target.
    const installUrl = new URL(
      `https://github.com/apps/${appSlug}/installations/select_target`,
    );
    installUrl.searchParams.set("state", state);
    return redirectWithInstallCookies(installUrl, redirectTo, state);
  }

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("state", state);
  const callbackUrl = new URL("/api/github/app/callback", req.url);
  authorizeUrl.searchParams.set("redirect_uri", callbackUrl.toString());
  return redirectWithInstallCookies(authorizeUrl, redirectTo, state);
}
