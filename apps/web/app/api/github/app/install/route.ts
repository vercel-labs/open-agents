import { generateState } from "arctic";
import { NextResponse, type NextRequest } from "next/server";
import { getInstallationsByUserId } from "@/lib/db/installations";
import { syncUserInstallations } from "@/lib/github/installations-sync";
import {
  getUserGitHubToken,
  getGitHubUsername,
  hasGitHubAccount,
} from "@/lib/github/token";
import { getServerSession } from "@/lib/session/get-server-session";

function sanitizeRedirectTo(rawRedirectTo: string | null): string {
  if (!rawRedirectTo) {
    return "/get-started";
  }

  if (!rawRedirectTo.startsWith("/") || rawRedirectTo.startsWith("//")) {
    return "/get-started";
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
    return NextResponse.redirect(new URL("/", req.url));
  }

  const appSlug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;
  if (!appSlug) {
    const fallbackUrl = new URL(redirectTo, req.url);
    fallbackUrl.searchParams.set("github", "app_not_configured");
    return NextResponse.redirect(fallbackUrl);
  }

  const state = generateState();

  // if a specific target_id is provided, go directly to install for that account
  const targetId = req.nextUrl.searchParams.get("target_id");
  if (targetId && /^\d+$/.test(targetId)) {
    const installUrl = new URL(
      `https://github.com/apps/${appSlug}/installations/new/permissions`,
    );
    installUrl.searchParams.set("state", state);
    installUrl.searchParams.set("target_id", targetId);
    return redirectWithInstallCookies(installUrl, redirectTo, state);
  }

  // no linked github account — redirect to get-started to connect first
  const linked = await hasGitHubAccount(session.user.id);
  if (!linked) {
    const connectUrl = new URL("/get-started", req.url);
    connectUrl.searchParams.set("github", "not_linked");
    connectUrl.searchParams.set("next", redirectTo);
    return NextResponse.redirect(connectUrl);
  }

  // try to sync installations
  let installations = await getInstallationsByUserId(session.user.id);

  if (installations.length === 0) {
    try {
      const token = await getUserGitHubToken(session.user.id);
      const username = await getGitHubUsername(session.user.id);
      if (token && username) {
        await syncUserInstallations(session.user.id, token, username);
        installations = await getInstallationsByUserId(session.user.id);
      }
    } catch (error) {
      console.error("Failed to sync GitHub installations in install flow:", {
        userId: session.user.id,
        error,
      });
    }
  }

  if (installations.length === 0) {
    // no installations — route to install page
    const installUrl = new URL(
      `https://github.com/apps/${appSlug}/installations/new/permissions`,
    );
    installUrl.searchParams.set("state", state);
    return redirectWithInstallCookies(installUrl, redirectTo, state);
  }

  // already has installations — show account/org picker for additional installs
  const installUrl = new URL(
    `https://github.com/apps/${appSlug}/installations/select_target`,
  );
  installUrl.searchParams.set("state", state);
  return redirectWithInstallCookies(installUrl, redirectTo, state);
}
