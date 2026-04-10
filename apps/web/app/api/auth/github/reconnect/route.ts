import { NextResponse, type NextRequest } from "next/server";

function sanitizeRedirectTo(rawRedirectTo: string | null): string {
  if (!rawRedirectTo) {
    return "/settings/connections";
  }

  if (!rawRedirectTo.startsWith("/") || rawRedirectTo.startsWith("//")) {
    return "/settings/connections";
  }

  return rawRedirectTo;
}

export async function GET(req: NextRequest): Promise<Response> {
  const redirectTo = sanitizeRedirectTo(req.nextUrl.searchParams.get("next"));
  const installUrl = new URL("/api/github/app/install", req.url);
  installUrl.searchParams.set("next", redirectTo);

  const response = NextResponse.redirect(installUrl);
  response.cookies.set("github_reconnect", "1", {
    path: "/",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 60 * 60,
    sameSite: "lax",
  });

  return response;
}
