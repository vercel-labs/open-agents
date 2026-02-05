import { generateState } from "arctic";
import { cookies } from "next/headers";
import { type NextRequest } from "next/server";

export async function GET(req: NextRequest): Promise<Response> {
  const clientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
  const redirectUri = `${req.nextUrl.origin}/api/auth/github/callback`;

  if (!clientId) {
    return Response.redirect(new URL("/?error=github_not_configured", req.url));
  }

  const state = generateState();
  const store = await cookies();
  const redirectTo = req.nextUrl.searchParams.get("next") ?? "/";

  store.set("github_auth_state", state, {
    path: "/",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 60 * 10,
    sameSite: "lax",
  });

  store.set("github_auth_redirect_to", redirectTo, {
    path: "/",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 60 * 10,
    sameSite: "lax",
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "repo,read:org,read:user,user:email",
    state: state,
  });

  return Response.redirect(
    `https://github.com/login/oauth/authorize?${params.toString()}`,
  );
}
