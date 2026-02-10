import { generateState } from "arctic";
import { cookies } from "next/headers";
import { type NextRequest } from "next/server";
import { getServerSession } from "@/lib/session/get-server-session";

export async function GET(req: NextRequest): Promise<Response> {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return new Response("Not authenticated", { status: 401 });
  }

  const clientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
  const redirectUri = `${req.nextUrl.origin}/api/auth/github/link/callback`;

  if (!clientId) {
    return Response.redirect(
      new URL("/settings/accounts?error=github_not_configured", req.url),
    );
  }

  const state = generateState();
  const store = await cookies();

  store.set("github_link_state", state, {
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
    state,
  });

  return Response.redirect(
    `https://github.com/login/oauth/authorize?${params.toString()}`,
  );
}
