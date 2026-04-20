import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { syncUserInstallations } from "@/lib/github/installations-sync";
import { getUserGitHubToken, getGitHubUsername } from "@/lib/github/token";
import { getServerSession } from "@/lib/session/get-server-session";

function sanitizeRedirectTo(rawRedirectTo: string | null | undefined): string {
  if (!rawRedirectTo) {
    return "/get-started";
  }

  if (!rawRedirectTo.startsWith("/") || rawRedirectTo.startsWith("//")) {
    return "/get-started";
  }

  return rawRedirectTo;
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

function redirectAndClearCookies(url: string | URL): NextResponse {
  const response = NextResponse.redirect(url);
  response.cookies.delete("github_app_install_redirect_to");
  response.cookies.delete("github_app_install_state");
  response.cookies.delete("github_reconnect");
  return response;
}

/**
 * GitHub App Setup URL callback — handles installation sync only.
 * OAuth token exchange is handled by better-auth at /api/auth/callback/github.
 */
export async function GET(req: Request): Promise<Response> {
  const cookieStore = await cookies();
  const redirectTo = sanitizeRedirectTo(
    cookieStore.get("github_app_install_redirect_to")?.value,
  );

  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  const redirectUrl = new URL(redirectTo, req.url);
  const requestUrl = new URL(req.url);
  const installationId = parseInstallationId(
    requestUrl.searchParams.get("installation_id"),
  );
  const setupAction = requestUrl.searchParams.get("setup_action");

  // get the user's github token from better-auth
  const token = await getUserGitHubToken(session.user.id);
  if (!token) {
    redirectUrl.searchParams.set("github", "not_linked");
    return redirectAndClearCookies(redirectUrl);
  }

  // sync installations
  let syncedInstallationsCount: number | null = null;
  const username = await getGitHubUsername(session.user.id);

  if (username) {
    try {
      syncedInstallationsCount = await syncUserInstallations(
        session.user.id,
        token,
        username,
      );
    } catch (error) {
      console.error("Failed syncing installations:", error);
    }
  }

  let githubStatus: string;
  if (setupAction === "request") {
    githubStatus = "request_sent";
  } else if ((syncedInstallationsCount ?? 0) > 0) {
    githubStatus = "connected";
  } else if (!installationId) {
    githubStatus = "no_action";
    redirectUrl.searchParams.set("missing_installation_id", "1");
  } else {
    githubStatus = "pending_sync";
  }

  redirectUrl.searchParams.set("github", githubStatus);
  return redirectAndClearCookies(redirectUrl);
}
