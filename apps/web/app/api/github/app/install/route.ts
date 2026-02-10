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

  // When the user disconnected their GitHub account (reconnect cookie is set),
  // the GitHub App may still be installed on their GitHub account. Sending them
  // to the install page would just show the existing installation settings
  // instead of re-authorizing. Redirect to the OAuth authorize URL so they
  // re-link their account and we can sync existing installations.
  const isReconnect = cookieStore.get("github_reconnect")?.value === "1";
  if (isReconnect) {
    const clientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
    if (clientId) {
      const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
      authorizeUrl.searchParams.set("client_id", clientId);
      authorizeUrl.searchParams.set("state", state);
      // Use the app callback so the existing handler exchanges the code,
      // links the account, and syncs installations in one step.
      const callbackUrl = new URL("/api/github/app/callback", req.url);
      authorizeUrl.searchParams.set("redirect_uri", callbackUrl.toString());
      return Response.redirect(authorizeUrl);
    }
  }

  // When a specific target_id is provided (numeric GitHub account/org ID),
  // link directly to the install permissions page for that account.
  // Otherwise, use select_target to always show the account/org picker.
  // (installations/new silently redirects to existing personal install settings.)
  const targetId = req.nextUrl.searchParams.get("target_id");
  const installUrl = new URL(
    `https://github.com/apps/${appSlug}/installations/select_target`,
  );
  installUrl.searchParams.set("state", state);

  if (targetId && /^\d+$/.test(targetId)) {
    installUrl.pathname = `/apps/${appSlug}/installations/new/permissions`;
    installUrl.searchParams.set("target_id", targetId);
    return Response.redirect(installUrl);
  }

  return Response.redirect(installUrl);
}
