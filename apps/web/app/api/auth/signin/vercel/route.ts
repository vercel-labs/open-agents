import { generateState } from "arctic";
import { cookies } from "next/headers";
import { type NextRequest } from "next/server";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  getVercelAuthorizationUrl,
} from "@/lib/vercel/oauth";

export async function GET(req: NextRequest): Promise<Response> {
  const clientId = process.env.NEXT_PUBLIC_VERCEL_APP_CLIENT_ID;
  const redirectUri = `${req.nextUrl.origin}/api/auth/vercel/callback`;

  if (!clientId) {
    return Response.redirect(new URL("/?error=vercel_not_configured", req.url));
  }

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const store = await cookies();
  const redirectTo = req.nextUrl.searchParams.get("next") ?? "/";

  store.set("vercel_auth_state", state, {
    path: "/",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 60 * 10,
    sameSite: "lax",
  });

  store.set("vercel_code_verifier", codeVerifier, {
    path: "/",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 60 * 10,
    sameSite: "lax",
  });

  store.set("vercel_auth_redirect_to", redirectTo, {
    path: "/",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 60 * 10,
    sameSite: "lax",
  });

  const url = getVercelAuthorizationUrl({
    clientId,
    redirectUri,
    state,
    codeChallenge,
  });

  return Response.redirect(url);
}
