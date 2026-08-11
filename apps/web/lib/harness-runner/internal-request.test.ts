import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  signInternalHarnessRequest,
  verifyInternalHarnessRequest,
} from "./internal-request";

const originalSecret = process.env.BETTER_AUTH_SECRET;

beforeEach(() => {
  process.env.BETTER_AUTH_SECRET = "test-internal-harness-secret";
});

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.BETTER_AUTH_SECRET;
  } else {
    process.env.BETTER_AUTH_SECRET = originalSecret;
  }
});

describe("internal harness request signatures", () => {
  test("accepts an exact signed body", () => {
    const body = JSON.stringify({ harnessId: "codex", messageId: "message-1" });
    const signature = signInternalHarnessRequest(body);

    expect(verifyInternalHarnessRequest(body, signature)).toBe(true);
    expect(verifyInternalHarnessRequest(`${body}\n`, signature)).toBe(false);
  });

  test("rejects missing and malformed signatures", () => {
    expect(verifyInternalHarnessRequest("{}", null)).toBe(false);
    expect(verifyInternalHarnessRequest("{}", "not-hex")).toBe(false);
    expect(verifyInternalHarnessRequest("{}", "12345")).toBe(false);
    expect(verifyInternalHarnessRequest("{}", ".deadbeef")).toBe(false);
    expect(verifyInternalHarnessRequest("{}", "notdigits.deadbeef")).toBe(
      false,
    );
  });

  test("rejects a signature whose timestamp was tampered with", () => {
    const body = "{}";
    const signature = signInternalHarnessRequest(body, 1_000_000);
    const digest = signature.slice(signature.indexOf(".") + 1);

    expect(
      verifyInternalHarnessRequest(body, `2000000.${digest}`, 2_000_000),
    ).toBe(false);
  });

  test("rejects stale signatures outside the validity window", () => {
    const body = "{}";
    const signedAt = Date.now();
    const signature = signInternalHarnessRequest(body, signedAt);

    expect(
      verifyInternalHarnessRequest(body, signature, signedAt + 4 * 60 * 1000),
    ).toBe(true);
    expect(
      verifyInternalHarnessRequest(body, signature, signedAt + 6 * 60 * 1000),
    ).toBe(false);
  });

  test("rejects signatures dated too far in the future", () => {
    const body = "{}";
    const now = Date.now();

    expect(
      verifyInternalHarnessRequest(
        body,
        signInternalHarnessRequest(body, now + 10 * 1000),
        now,
      ),
    ).toBe(true);
    expect(
      verifyInternalHarnessRequest(
        body,
        signInternalHarnessRequest(body, now + 60 * 1000),
        now,
      ),
    ).toBe(false);
  });

  test("does not validate signatures minted with the raw deployment secret", () => {
    // Guards the purpose-scoped key derivation: an HMAC minted with
    // BETTER_AUTH_SECRET directly (what any other consumer of the secret
    // would produce) must not verify.
    const body = "{}";
    const now = Date.now();
    const rawDigest = createHmac("sha256", "test-internal-harness-secret")
      .update(`${now}.${body}`)
      .digest("hex");

    expect(verifyInternalHarnessRequest(body, `${now}.${rawDigest}`, now)).toBe(
      false,
    );
  });
});
