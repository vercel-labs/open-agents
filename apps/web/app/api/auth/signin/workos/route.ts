import crypto from "crypto";
import { cookies } from "next/headers";
import { type NextRequest } from "next/server";
import { workos } from "@/lib/workos/client";

export async function GET(req: NextRequest): Promise<Response> {
  const clientId = process.env.WORKOS_CLIENT_ID;

  if (!clientId) {
    return Response.redirect(new URL("/?error=workos_not_configured", req.url));
  }

  const state = crypto.randomBytes(32).toString("base64url");
  const redirectUri = `${req.nextUrl.origin}/api/auth/workos/callback`;
  const store = await cookies();
  const redirectTo = req.nextUrl.searchParams.get("next") ?? "/";

  store.set("workos_auth_state", state, {
    path: "/",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 60 * 10,
    sameSite: "lax",
  });

  store.set("workos_auth_redirect_to", redirectTo, {
    path: "/",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 60 * 10,
    sameSite: "lax",
  });

  const url = workos.userManagement.getAuthorizationUrl({
    provider: "authkit",
    clientId,
    redirectUri,
    state,
  });

  return Response.redirect(url);
}
