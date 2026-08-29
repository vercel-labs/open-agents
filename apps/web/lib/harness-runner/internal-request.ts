import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * How long a signed request stays valid. The signing workflow step calls the
 * route immediately, so anything older is a replay or a badly skewed clock.
 */
const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;
/** Tolerated clock skew for signatures dated slightly in the future. */
const SIGNATURE_MAX_FUTURE_SKEW_MS = 30 * 1000;

/**
 * Dedicated secret for internal harness calls, deliberately separate from
 * `BETTER_AUTH_SECRET`: the session secret has a different blast radius,
 * rotation cadence, and set of consumers, and sharing one value would mean a
 * leak of either use compromises both.
 */
function readInternalHarnessSecret(): string | undefined {
  return process.env.INTERNAL_HARNESS_SECRET || undefined;
}

function requireInternalHarnessSecret(): string {
  const secret = readInternalHarnessSecret();
  if (!secret) {
    throw new Error(
      "INTERNAL_HARNESS_SECRET is required to run external agent harnesses. Generate one with `openssl rand -base64 32` and set it on this deployment.",
    );
  }
  return secret;
}

/**
 * Purpose-scoped signing key: HMAC the dedicated secret with a fixed info
 * string so a signature minted here can never validate against anything else
 * that signs with `INTERNAL_HARNESS_SECRET` directly (and vice versa).
 */
function getSigningKey(secret: string): Buffer {
  return createHmac("sha256", secret)
    .update("open-agents-harness-runner-v1")
    .digest();
}

/**
 * The signature binds the request line as well as the body, so a signature
 * captured for one internal endpoint cannot be replayed against another one
 * (or against the same path with a different method).
 */
function normalizePath(url: string): string {
  const { pathname } = new URL(url);
  return pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
}

function computeDigest(
  secret: string,
  request: { method: string; url: string; body: string },
  timestampMs: number,
): Buffer {
  return createHmac("sha256", getSigningKey(secret))
    .update(
      [
        request.method.toUpperCase(),
        normalizePath(request.url),
        String(timestampMs),
        request.body,
      ].join("\n"),
    )
    .digest();
}

export type InternalHarnessRequest = {
  method: string;
  /** Absolute URL the request is sent to; only its path is signed. */
  url: string;
  body: string;
};

/**
 * Sign a request. The signature is `<unix ms>.<hex hmac>` with the timestamp
 * included in the signed material, so a captured request stops validating
 * once it falls outside the freshness window.
 */
export function signInternalHarnessRequest(
  request: InternalHarnessRequest,
  timestampMs: number = Date.now(),
): string {
  const digest = computeDigest(
    requireInternalHarnessSecret(),
    request,
    timestampMs,
  );
  return `${timestampMs}.${digest.toString("hex")}`;
}

export function verifyInternalHarnessRequest(
  request: InternalHarnessRequest & { signature: string | null },
  nowMs: number = Date.now(),
): boolean {
  // Fail closed rather than throwing: a deployment missing the secret cannot
  // authenticate anyone, and the route guard should answer its usual 404 for
  // that instead of surfacing a 500 that confirms the endpoint exists.
  const secret = readInternalHarnessSecret();
  if (!(secret && request.signature)) {
    return false;
  }

  const separatorIndex = request.signature.indexOf(".");
  if (separatorIndex <= 0) {
    return false;
  }

  const timestampPart = request.signature.slice(0, separatorIndex);
  const digestPart = request.signature.slice(separatorIndex + 1);
  if (!/^\d{1,15}$/.test(timestampPart)) {
    return false;
  }

  const timestampMs = Number(timestampPart);
  // A route can be reached with a URL the parser rejects, and there is no path
  // to sign for one. Fail closed rather than letting it become a 500.
  let expected: Buffer;
  try {
    expected = computeDigest(secret, request, timestampMs);
  } catch {
    return false;
  }
  const actual = Buffer.from(digestPart, "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return false;
  }

  const ageMs = nowMs - timestampMs;
  return (
    ageMs <= SIGNATURE_MAX_AGE_MS && -ageMs <= SIGNATURE_MAX_FUTURE_SKEW_MS
  );
}
