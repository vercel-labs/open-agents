import {
  CODESPACE_PROXY_BASE_PATH,
  CODESPACE_TARGET_COOKIE,
} from "@/lib/sandbox/config";
import { SESSION_COOKIE_NAME } from "@/lib/session/constants";
import { getSessionFromCookie } from "@/lib/session/server";

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

/** Headers that must not be forwarded to the sandbox. */
const STRIP_REQUEST_HEADERS = new Set([
  "host",
  "cookie",
  "origin",
  "referer",
  "connection",
]);

/** Headers that must not be returned from the proxy to the client. */
const STRIP_RESPONSE_HEADERS = new Set([
  "set-cookie",
  "transfer-encoding",
  "connection",
  "content-encoding",
  "content-length",
]);

async function proxyRequest(
  request: Request,
  params: { path?: string[] },
): Promise<Response> {
  // ---- Auth check ------------------------------------------------
  const cookieHeader = request.headers.get("cookie") ?? "";
  const sessionCookieValue = parseCookieValue(
    cookieHeader,
    SESSION_COOKIE_NAME,
  );
  if (!sessionCookieValue) {
    return new Response("Unauthorized", { status: 401 });
  }

  const session = await getSessionFromCookie(sessionCookieValue);
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  // ---- Resolve sandbox target ------------------------------------
  const targetBase = parseCookieValue(cookieHeader, CODESPACE_TARGET_COOKIE);
  if (!targetBase) {
    return new Response("No active codespace", { status: 404 });
  }
  const decodedTarget = decodeURIComponent(targetBase);

  // ---- Build proxy URL -------------------------------------------
  const subPath = params.path?.join("/") ?? "";
  const proxyPath = subPath
    ? `${CODESPACE_PROXY_BASE_PATH}/${subPath}`
    : `${CODESPACE_PROXY_BASE_PATH}/`;
  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(proxyPath, decodedTarget);
  targetUrl.search = incomingUrl.search;

  // ---- Forward request -------------------------------------------
  const forwardHeaders = new Headers();
  for (const [key, value] of request.headers) {
    if (!STRIP_REQUEST_HEADERS.has(key.toLowerCase())) {
      forwardHeaders.set(key, value);
    }
  }
  forwardHeaders.set("host", new URL(decodedTarget).host);

  const fetchInit: RequestInit & { duplex?: string } = {
    method: request.method,
    headers: forwardHeaders,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD" && request.body) {
    fetchInit.body = request.body;
    fetchInit.duplex = "half";
  }

  let targetResponse: Response;
  try {
    targetResponse = await fetch(targetUrl.toString(), fetchInit);
  } catch {
    return new Response("Upstream unavailable", { status: 502 });
  }

  // ---- Build client response -------------------------------------
  const responseHeaders = new Headers();
  for (const [key, value] of targetResponse.headers) {
    if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  }

  // Rewrite Location headers on redirects so they stay within the proxy
  if (targetResponse.status >= 300 && targetResponse.status < 400) {
    const location = targetResponse.headers.get("location");
    if (location) {
      try {
        const locUrl = new URL(location, decodedTarget);
        // If the redirect points to the sandbox, rewrite to our proxy path
        if (locUrl.origin === new URL(decodedTarget).origin) {
          responseHeaders.set("location", `${locUrl.pathname}${locUrl.search}`);
        }
      } catch {
        // Leave location as-is if it can't be parsed
      }
    }
  }

  return new Response(targetResponse.body, {
    status: targetResponse.status,
    statusText: targetResponse.statusText,
    headers: responseHeaders,
  });
}

/**
 * Extract a single cookie value from a raw Cookie header string.
 * Avoids pulling in next/headers so this works in all runtimes.
 */
function parseCookieValue(
  cookieHeader: string,
  name: string,
): string | undefined {
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.split("=");
    if (key.trim() === name) {
      return rest.join("=").trim();
    }
  }
  return undefined;
}

// ---- HTTP method handlers ----------------------------------------

export async function GET(request: Request, context: RouteContext) {
  return proxyRequest(request, await context.params);
}

export async function POST(request: Request, context: RouteContext) {
  return proxyRequest(request, await context.params);
}

export async function PUT(request: Request, context: RouteContext) {
  return proxyRequest(request, await context.params);
}

export async function DELETE(request: Request, context: RouteContext) {
  return proxyRequest(request, await context.params);
}

export async function PATCH(request: Request, context: RouteContext) {
  return proxyRequest(request, await context.params);
}

export async function HEAD(request: Request, context: RouteContext) {
  return proxyRequest(request, await context.params);
}

export async function OPTIONS(request: Request, context: RouteContext) {
  return proxyRequest(request, await context.params);
}
