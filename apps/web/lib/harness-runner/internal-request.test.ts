import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  signInternalHarnessRequest,
  verifyInternalHarnessRequest,
} from "./internal-request";

const originalInternalSecret = process.env.INTERNAL_HARNESS_SECRET;
const originalAuthSecret = process.env.BETTER_AUTH_SECRET;

const RUNNER_URL = "https://preview.example.com/api/internal/harness-runner";

function restore(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

beforeEach(() => {
  process.env.INTERNAL_HARNESS_SECRET = "test-internal-harness-secret";
  process.env.BETTER_AUTH_SECRET = "test-session-secret";
});

afterEach(() => {
  restore("INTERNAL_HARNESS_SECRET", originalInternalSecret);
  restore("BETTER_AUTH_SECRET", originalAuthSecret);
});

function sign(body: string, timestampMs?: number) {
  return signInternalHarnessRequest(
    { method: "POST", url: RUNNER_URL, body },
    timestampMs,
  );
}

function verify(
  body: string,
  signature: string | null,
  overrides: { method?: string; url?: string; nowMs?: number } = {},
) {
  return verifyInternalHarnessRequest(
    {
      method: overrides.method ?? "POST",
      url: overrides.url ?? RUNNER_URL,
      body,
      signature,
    },
    overrides.nowMs,
  );
}

describe("internal harness request signatures", () => {
  test("accepts an exact signed request", () => {
    const body = JSON.stringify({ harnessId: "codex", messageId: "message-1" });
    const signature = sign(body);

    expect(verify(body, signature)).toBe(true);
    expect(verify(`${body}\n`, signature)).toBe(false);
  });

  test("rejects missing and malformed signatures", () => {
    expect(verify("{}", null)).toBe(false);
    expect(verify("{}", "not-hex")).toBe(false);
    expect(verify("{}", "12345")).toBe(false);
    expect(verify("{}", ".deadbeef")).toBe(false);
    expect(verify("{}", "notdigits.deadbeef")).toBe(false);
  });

  test("rejects a signature whose timestamp was tampered with", () => {
    const body = "{}";
    const signature = sign(body, 1_000_000);
    const digest = signature.slice(signature.indexOf(".") + 1);

    expect(verify(body, `2000000.${digest}`, { nowMs: 2_000_000 })).toBe(false);
  });

  test("rejects stale signatures outside the validity window", () => {
    const body = "{}";
    const signedAt = Date.now();
    const signature = sign(body, signedAt);

    expect(verify(body, signature, { nowMs: signedAt + 4 * 60 * 1000 })).toBe(
      true,
    );
    expect(verify(body, signature, { nowMs: signedAt + 6 * 60 * 1000 })).toBe(
      false,
    );
  });

  test("rejects signatures dated too far in the future", () => {
    const body = "{}";
    const now = Date.now();

    expect(verify(body, sign(body, now + 10 * 1000), { nowMs: now })).toBe(
      true,
    );
    expect(verify(body, sign(body, now + 60 * 1000), { nowMs: now })).toBe(
      false,
    );
  });

  test("binds the signature to the request method and path", () => {
    const body = "{}";
    const signature = sign(body);

    expect(verify(body, signature, { method: "GET" })).toBe(false);
    expect(
      verify(body, signature, {
        url: "https://preview.example.com/api/internal/other-runner",
      }),
    ).toBe(false);
    // Host, query, and a trailing slash are not part of the signed material.
    expect(
      verify(body, signature, {
        url: "https://other.example.com/api/internal/harness-runner/?a=1",
      }),
    ).toBe(true);
  });

  test("does not validate signatures minted with the raw dedicated secret", () => {
    // Guards the purpose-scoped key derivation: an HMAC minted with
    // INTERNAL_HARNESS_SECRET directly (what any other consumer of the secret
    // would produce) must not verify.
    const body = "{}";
    const now = Date.now();
    const rawDigest = createHmac("sha256", "test-internal-harness-secret")
      .update(`POST\n/api/internal/harness-runner\n${now}\n${body}`)
      .digest("hex");

    expect(verify(body, `${now}.${rawDigest}`, { nowMs: now })).toBe(false);
  });

  test("does not accept signatures keyed by the session secret", () => {
    // The two secrets are deliberately distinct: material minted from
    // BETTER_AUTH_SECRET must be worthless here.
    const body = "{}";
    const now = Date.now();
    process.env.INTERNAL_HARNESS_SECRET = "test-session-secret";
    const sessionKeyedSignature = sign(body, now);
    process.env.INTERNAL_HARNESS_SECRET = "test-internal-harness-secret";

    expect(verify(body, sessionKeyedSignature, { nowMs: now })).toBe(false);
  });

  test("fails closed when the dedicated secret is unset", () => {
    const body = "{}";
    const signature = sign(body);
    delete process.env.INTERNAL_HARNESS_SECRET;

    // Verification must not throw (that would turn a misconfiguration into a
    // 500 that confirms the endpoint exists) and must not fall back to
    // BETTER_AUTH_SECRET.
    expect(verify(body, signature)).toBe(false);
    expect(() => sign(body)).toThrow("INTERNAL_HARNESS_SECRET is required");
  });
});
