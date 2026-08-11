import { createHmac, timingSafeEqual } from "node:crypto";

export const INTERNAL_HARNESS_SIGNATURE_HEADER =
  "x-open-agents-harness-signature";

/**
 * How long a signed request stays valid. The signing workflow step calls the
 * route immediately, so anything older is a replay or a badly skewed clock.
 */
const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;
/** Tolerated clock skew for signatures dated slightly in the future. */
const SIGNATURE_MAX_FUTURE_SKEW_MS = 30 * 1000;

function getInternalHarnessSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET is required for internal harness calls",
    );
  }
  return secret;
}

/**
 * Purpose-scoped signing key: HMAC the deployment secret with a fixed info
 * string so a signature minted here can never validate against anything else
 * that signs with `BETTER_AUTH_SECRET` directly (and vice versa).
 */
function getSigningKey(): Buffer {
  return createHmac("sha256", getInternalHarnessSecret())
    .update("open-agents-harness-runner-v1")
    .digest();
}

function computeDigest(timestampMs: number, body: string): Buffer {
  return createHmac("sha256", getSigningKey())
    .update(`${timestampMs}.${body}`)
    .digest();
}

/**
 * Sign a request body. The signature is `<unix ms>.<hex hmac>` with the
 * timestamp included in the signed material, so a captured request stops
 * validating once it falls outside the freshness window.
 */
export function signInternalHarnessRequest(
  body: string,
  timestampMs: number = Date.now(),
): string {
  return `${timestampMs}.${computeDigest(timestampMs, body).toString("hex")}`;
}

export function verifyInternalHarnessRequest(
  body: string,
  signature: string | null,
  nowMs: number = Date.now(),
): boolean {
  if (!signature) {
    return false;
  }

  const separatorIndex = signature.indexOf(".");
  if (separatorIndex <= 0) {
    return false;
  }

  const timestampPart = signature.slice(0, separatorIndex);
  const digestPart = signature.slice(separatorIndex + 1);
  if (!/^\d{1,15}$/.test(timestampPart)) {
    return false;
  }

  const timestampMs = Number(timestampPart);
  const expected = computeDigest(timestampMs, body);
  const actual = Buffer.from(digestPart, "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return false;
  }

  const ageMs = nowMs - timestampMs;
  return (
    ageMs <= SIGNATURE_MAX_AGE_MS && -ageMs <= SIGNATURE_MAX_FUTURE_SKEW_MS
  );
}
