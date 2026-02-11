import { generateState } from "arctic";
import { cookies } from "next/headers";
import { type NextRequest } from "next/server";
import { getServerSession } from "@/lib/session/get-server-session";

function sanitizeRedirectTo(rawRedirectTo: string | null): string {
  if (!rawRedirectTo) {
    return "/settings/accounts";
  }

  if (!rawRedirectTo.startsWith("/") || rawRedirectTo.startsWith("//")) {
    return "/settings/accounts";
  }

  return rawRedirectTo;
}

function setInstallCookies(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  redirectTo: string,
  state: string,
) {
  cookieStore.set("github_app_install_redirect_to", redirectTo, {
    path: "/",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 60 * 15,
    sameSite: "lax",
  });

  cookieStore.set("github_app_install_state", state, {
    path: "/",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 60 * 15,
    sameSite: "lax",
  });
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
    return Response.redirect(signinUrl);
  }

  const appSlug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;
  if (!appSlug) {
    const fallbackUrl = new URL(redirectTo, req.url);
    fallbackUrl.searchParams.set("github", "app_not_configured");
    return Response.redirect(fallbackUrl);
  }

  const cookieStore = await cookies();
  const state = generateState();

  setInstallCookies(cookieStore, redirectTo, state);

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
    return Response.redirect(installUrl);
  }

  // For the initial "Connect GitHub" flow, always use the OAuth authorize URL
  // with an explicit redirect_uri. The select_target install page only
  // triggers a callback redirect for NEW installations; if the app is already
  // installed it just shows the installation settings page with no redirect.
  // OAuth works regardless of installation state and lets us dynamically pick
  // the correct callback domain (dev vs production). The callback handler
  // exchanges the code, links the account, and syncs existing installations.
  const clientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
  if (clientId) {
    const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("state", state);
    const callbackUrl = new URL("/api/github/app/callback", req.url);
    authorizeUrl.searchParams.set("redirect_uri", callbackUrl.toString());
    return Response.redirect(authorizeUrl);
  }

  // Fallback: if no client ID configured, try the install page directly.
  const installUrl = new URL(
    `https://github.com/apps/${appSlug}/installations/select_target`,
  );
  installUrl.searchParams.set("state", state);
  return Response.redirect(installUrl);
}
