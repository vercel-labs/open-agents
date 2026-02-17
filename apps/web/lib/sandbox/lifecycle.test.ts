import { beforeAll, describe, expect, mock, test } from "bun:test";

import {
  SANDBOX_EXPIRES_BUFFER_MS,
  SANDBOX_INACTIVITY_TIMEOUT_MS,
} from "./config";

mock.module("server-only", () => ({}));

let lifecycleModule: typeof import("./lifecycle");

beforeAll(async () => {
  lifecycleModule = await import("./lifecycle");
});

describe("getLifecycleDueAtMs", () => {
  test("prefers hibernateAfter when earlier than expiry", () => {
    const baseMs = Date.UTC(2025, 0, 1, 0, 0, 0);
    const record = {
      hibernateAfter: new Date(baseMs + 15 * 60 * 1000),
      lastActivityAt: new Date(baseMs),
      sandboxExpiresAt: new Date(baseMs + 5 * 60 * 60 * 1000),
      updatedAt: new Date(baseMs),
    };

    expect(lifecycleModule.getLifecycleDueAtMs(record)).toBe(
      record.hibernateAfter.getTime(),
    );
  });

  test("uses sandbox expiry when it is earlier", () => {
    const baseMs = Date.UTC(2025, 0, 1, 0, 0, 0);
    const expiresAt = new Date(baseMs + 10 * 60 * 1000);
    const record = {
      hibernateAfter: new Date(baseMs + 30 * 60 * 1000),
      lastActivityAt: new Date(baseMs),
      sandboxExpiresAt: expiresAt,
      updatedAt: new Date(baseMs),
    };

    expect(lifecycleModule.getLifecycleDueAtMs(record)).toBe(
      expiresAt.getTime() - SANDBOX_EXPIRES_BUFFER_MS,
    );
  });

  test("falls back to lastActivityAt when hibernateAfter is missing", () => {
    const baseMs = Date.UTC(2025, 0, 1, 0, 0, 0);
    const lastActivityAt = new Date(baseMs + 2 * 60 * 1000);
    const record = {
      hibernateAfter: null,
      lastActivityAt,
      sandboxExpiresAt: null,
      updatedAt: new Date(baseMs),
    };

    expect(lifecycleModule.getLifecycleDueAtMs(record)).toBe(
      lastActivityAt.getTime() + SANDBOX_INACTIVITY_TIMEOUT_MS,
    );
  });

  test("falls back to updatedAt when lastActivityAt is missing", () => {
    const baseMs = Date.UTC(2025, 0, 1, 0, 0, 0);
    const updatedAt = new Date(baseMs + 3 * 60 * 1000);
    const record = {
      hibernateAfter: null,
      lastActivityAt: null,
      sandboxExpiresAt: null,
      updatedAt,
    };

    expect(lifecycleModule.getLifecycleDueAtMs(record)).toBe(
      updatedAt.getTime() + SANDBOX_INACTIVITY_TIMEOUT_MS,
    );
  });
});
