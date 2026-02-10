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
  cookieStore.set("github_app_install_redirect_to", redirectTo, {
    path: "/",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 60 * 15,
    sameSite: "lax",
  });

  // When a specific target_id is provided (numeric GitHub account/org ID),
  // link directly to the install permissions page for that account.
  // Otherwise, use select_target to always show the account/org picker.
  // (installations/new silently redirects to existing personal install settings.)
  const targetId = req.nextUrl.searchParams.get("target_id");

  if (targetId && /^\d+$/.test(targetId)) {
    return Response.redirect(
      `https://github.com/apps/${appSlug}/installations/new/permissions?target_id=${targetId}`,
    );
  }

  return Response.redirect(
    `https://github.com/apps/${appSlug}/installations/select_target`,
  );
}
