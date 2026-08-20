import { NextResponse, type NextRequest } from "next/server";
import {
  INTERNAL_API_PATH_PREFIX,
  INTERNAL_API_REJECTED_STATUS,
  INTERNAL_API_RESPONSE_HEADERS,
  INTERNAL_HARNESS_SIGNATURE_HEADER,
} from "@/lib/harness-runner/internal-endpoints";

/**
 * `/api/internal/*` endpoints are called by the deployment itself, never by a
 * browser, and their handlers are expensive — the harness runner holds a
 * streaming connection open for a whole agent turn (`maxDuration = 800`).
 * Dropping traffic that cannot possibly be one of those calls saves booting the
 * function for it.
 *
 * That is all this is: an optimization. It is deliberately *not* load-bearing.
 * `withInternalRouteGuard` in `lib/harness-runner/internal-route.ts` runs inside
 * the route bundle and is what decides whether a call is authentic — it requires
 * the same signature, bounds the same body, and answers the same `404` — so this
 * block can be narrowed, broken, or deleted without changing what any internal
 * endpoint accepts. Do not move a control here that the route does not also
 * apply.
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
    // Dropped with the status the route's own guard answers an unauthenticated
    // call with. This layer grants nothing, so whether it runs only decides
    // whether the function boots — a non-POST verb that does get through is
    // answered by Next's own `405`.
    return isPossibleInternalApiRequest(request)
      ? NextResponse.next()
      : new NextResponse(null, {
          status: INTERNAL_API_REJECTED_STATUS,
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
