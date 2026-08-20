import {
  INTERNAL_API_REJECTED_STATUS,
  INTERNAL_API_RESPONSE_HEADERS,
  INTERNAL_HARNESS_SIGNATURE_HEADER,
} from "./internal-endpoints";
import { verifyInternalHarnessRequest } from "./internal-request";

/**
 * Route-side guard for `/api/internal/*`.
 *
 * Every control an internal endpoint needs in order to be safe lives here,
 * inside the route bundle, because this is the only layer nothing can skip:
 * `proxy.ts` filters the same traffic, but a proxy is an optimization, not a
 * control. It is one `matcher` edit away from not covering a path, it is not
 * guaranteed to run for every way a deployment's functions can be reached, and
 * Next middleware has had outright bypass vulnerabilities in the past
 * (CVE-2025-29927). Deleting its internal branch must cost wasted compute and
 * nothing else.
 *
 * HTTP verb handling is deliberately *not* here. An internal route exports
 * `POST` and nothing else, so Next answers `405` for every other verb on its
 * own — no handler runs, and hand-rolling one only trades that `405` for a
 * `404` that hides nothing an attacker cannot learn from any other path. What
 * keeps the endpoint POST-only is the signature: it covers the method, so
 * reaching a handler with a different verb would take a signature minted for
 * that verb, which takes the secret.
 */

/**
 * Ceiling on the request body an unauthenticated caller can make an internal
 * route buffer. The signature covers the body, so it cannot be verified until
 * the body has been read; this cap is what keeps that read from being unbounded
 * work for anyone who can reach the route (the harness runner's `maxDuration`
 * is 800s). Deliberately generous — a real body is one chat's message history
 * as JSON — because it is a ceiling on abuse, not a budget for callers.
 */
export const INTERNAL_API_MAX_BODY_BYTES = 5 * 1024 * 1024;

type InternalRouteHandler = (
  request: Request,
  body: string,
) => Response | Promise<Response>;

function safePathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "<unparseable url>";
  }
}

/**
 * Reject without telling the caller why. The reason is logged instead: an
 * internal endpoint's only legitimate caller is this deployment, so a rejection
 * is either an attack (owed no detail) or a bug worth a server-side log line.
 */
function reject(request: Request, reason: string): Response {
  console.warn(
    `[internal-api] Rejected ${request.method} ${safePathname(request.url)}: ${reason}`,
  );
  return new Response(null, {
    status: INTERNAL_API_REJECTED_STATUS,
    headers: INTERNAL_API_RESPONSE_HEADERS,
  });
}

/**
 * Internal responses are never cached, whatever a handler returns and whether
 * or not the proxy ran.
 */
function withInternalResponseHeaders(response: Response): Response {
  for (const [name, value] of Object.entries(INTERNAL_API_RESPONSE_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

type BoundedBody = { ok: true; body: string } | { ok: false; reason: string };

async function readBoundedBody(request: Request): Promise<BoundedBody> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isInteger(length) || length < 0) {
      return { ok: false, reason: "malformed content-length" };
    }
    if (length > INTERNAL_API_MAX_BODY_BYTES) {
      return {
        ok: false,
        reason: `content-length ${length} over the ${INTERNAL_API_MAX_BODY_BYTES} byte cap`,
      };
    }
  }

  if (!request.body) {
    return { ok: true, body: "" };
  }

  // Read the stream rather than calling `request.text()`, so a missing or
  // untruthful content-length cannot buffer more than the cap either.
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > INTERNAL_API_MAX_BODY_BYTES) {
      await reader.cancel();
      return {
        ok: false,
        reason: `body over the ${INTERNAL_API_MAX_BODY_BYTES} byte cap`,
      };
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  // Decoded in one pass over the whole body: a multi-byte character can
  // straddle a chunk boundary.
  return { ok: true, body: new TextDecoder().decode(merged) };
}

/**
 * Wrap an internal endpoint's POST handler. The handler only runs for a request
 * that carried a fresh HMAC over its own method, path, and body, and it
 * receives that already-read body so it cannot accidentally re-read an
 * unverified one.
 */
export function withInternalRouteGuard(
  handler: InternalRouteHandler,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    // Checked before the body is touched: an unsigned caller does not get to
    // hand this route any bytes at all.
    const signature = request.headers.get(INTERNAL_HARNESS_SIGNATURE_HEADER);
    if (!signature) {
      return reject(request, "missing signature header");
    }

    const read = await readBoundedBody(request);
    if (!read.ok) {
      return reject(request, read.reason);
    }

    if (
      !verifyInternalHarnessRequest({
        method: request.method,
        url: request.url,
        body: read.body,
        signature,
      })
    ) {
      return reject(request, "invalid, stale, or misdirected signature");
    }

    return withInternalResponseHeaders(await handler(request, read.body));
  };
}
