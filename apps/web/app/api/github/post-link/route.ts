import { NextResponse } from "next/server";
import { getInstallationsByUserId } from "@/lib/db/installations";
import { getUserGitHubToken, getGitHubUsername } from "@/lib/github/token";
import { syncUserInstallations } from "@/lib/github/installations-sync";
import { getServerSession } from "@/lib/session/get-server-session";

/**
 * After better-auth completes the GitHub OAuth link, it redirects here.
 * We sync installations and chain to the GitHub App install page if needed.
 */
export async function GET(req: Request): Promise<Response> {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  const requestUrl = new URL(req.url);
  const next = requestUrl.searchParams.get("next") ?? "/get-started";
  const redirectUrl = new URL(next, req.url);

  const token = await getUserGitHubToken(session.user.id);
  if (!token) {
    redirectUrl.searchParams.set("github", "link_failed");
    return NextResponse.redirect(redirectUrl);
  }

  // sync installations using the freshly-linked token
  const username = await getGitHubUsername(session.user.id);
  if (username) {
    try {
      const count = await syncUserInstallations(
        session.user.id,
        token,
        username,
      );

      if (count > 0) {
        redirectUrl.searchParams.set("github", "connected");
        return NextResponse.redirect(redirectUrl);
      }
    } catch (error) {
      console.error("Failed syncing installations after GitHub link:", error);
    }
  }

  // no installations found — check if any exist in DB from a previous install
  const existingInstallations = await getInstallationsByUserId(session.user.id);
  if (existingInstallations.length > 0) {
    redirectUrl.searchParams.set("github", "connected");
    return NextResponse.redirect(redirectUrl);
  }

  // no installations at all — redirect to GitHub App install page
  const appSlug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;
  if (appSlug) {
    const installUrl = new URL(
      `https://github.com/apps/${appSlug}/installations/new`,
    );
    return NextResponse.redirect(installUrl);
  }

  redirectUrl.searchParams.set("github", "connected");
  return NextResponse.redirect(redirectUrl);
}
