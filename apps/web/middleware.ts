import { NextResponse, type NextRequest } from "next/server";
import {
  CODESPACE_PROXY_BASE_PATH,
  CODESPACE_TARGETS_COOKIE,
} from "@/lib/sandbox/config";
import { SESSION_COOKIE_NAME } from "@/lib/session/constants";
import { getSessionFromCookie } from "@/lib/session/server";

/**
 * Middleware that proxies codespace requests to the real sandbox origin.
 *
 * Path structure: /codespace-proxy/{sessionId}/...rest
 *
 * 1. Validates the user's session cookie
 * 2. Reads the codespace-targets cookie to resolve the sandbox URL
 * 3. Rewrites the request to the sandbox origin (Vercel handles the full
 *    connection including WebSocket upgrades)
 */
export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Extract sessionId from the first segment after the base path
  const prefix = `${CODESPACE_PROXY_BASE_PATH}/`;
  const afterPrefix = pathname.slice(prefix.length);
  const slashIndex = afterPrefix.indexOf("/");
  const sessionId =
    slashIndex === -1 ? afterPrefix : afterPrefix.slice(0, slashIndex);

  if (!sessionId) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Auth: validate the encrypted session cookie
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const session = await getSessionFromCookie(sessionCookie);
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Resolve the sandbox URL from the targets cookie
  const targetsCookie = request.cookies.get(CODESPACE_TARGETS_COOKIE)?.value;
  if (!targetsCookie) {
    return new NextResponse("No active codespace", { status: 404 });
  }

  let targets: Record<string, string>;
  try {
    targets = JSON.parse(decodeURIComponent(targetsCookie));
  } catch {
    return new NextResponse("Invalid codespace target", { status: 400 });
  }

  const sandboxUrl = targets[sessionId];
  if (!sandboxUrl) {
    return new NextResponse("No active codespace for this session", {
      status: 404,
    });
  }

  // Rewrite to the sandbox origin — Vercel proxies the full connection
  // including WebSocket upgrades transparently.
  const targetUrl = new URL(pathname + request.nextUrl.search, sandboxUrl);

  return NextResponse.rewrite(targetUrl);
}

export const config = {
  matcher: "/codespace-proxy/:path*",
};
