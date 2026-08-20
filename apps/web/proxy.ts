import { NextResponse, type NextRequest } from "next/server";
import {
  INTERNAL_API_PATH_PREFIX,
  INTERNAL_API_RESPONSE_HEADERS,
  INTERNAL_HARNESS_SIGNATURE_HEADER,
} from "@/lib/harness-runner/internal-endpoints";

/**
 * `/api/internal/*` endpoints are called by the deployment itself, never by a
 * browser, and their handlers are expensive — the harness runner holds a
 * streaming connection open for a whole agent turn. Drop anything that cannot
 * possibly be one of those calls before it reaches a handler, and answer 404
 * so the endpoints stay undiscoverable from outside.
 *
 * This is the outer layer, not the authorization check: handlers still verify
 * the signature. Every internal caller signs with the harness signature
 * header, so requiring it here costs nothing and rejects unauthenticated
 * traffic without spinning up the route.
 */
function isPossibleInternalApiRequest(request: NextRequest): boolean {
  return (
    request.method === "POST" &&
    request.headers.has(INTERNAL_HARNESS_SIGNATURE_HEADER)
  );
}

function wantsSharedMarkdown(acceptHeader: string | null): boolean {
  if (!acceptHeader) {
    return false;
  }

  const accept = acceptHeader.toLowerCase();
  return accept.includes("text/markdown") || accept.includes("text/plain");
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (pathname.startsWith(INTERNAL_API_PATH_PREFIX)) {
    return isPossibleInternalApiRequest(request)
      ? NextResponse.next()
      : new NextResponse(null, {
          status: 404,
          headers: INTERNAL_API_RESPONSE_HEADERS,
        });
  }

  if (request.method !== "GET") {
    return NextResponse.next();
  }

  const segments = pathname.split("/").filter(Boolean);

  if (
    segments.length === 2 &&
    segments[0] === "shared" &&
    wantsSharedMarkdown(request.headers.get("accept"))
  ) {
    const rewrittenUrl = request.nextUrl.clone();
    rewrittenUrl.pathname = `/api/shared/${segments[1]}/markdown`;
    return NextResponse.rewrite(rewrittenUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/internal/:path*", "/shared/:path*"],
};
