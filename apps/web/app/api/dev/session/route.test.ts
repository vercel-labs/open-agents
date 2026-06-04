import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { NextRequest } from "next/server";

type UserRow = { id: string; username: string; email: string | null };

let existingBotUser: UserRow | undefined;
const insertCalls: Array<{ table: unknown; values: Record<string, unknown> }> =
  [];
const updateCalls: Array<{ table: unknown; values: Record<string, unknown> }> =
  [];
const deleteCalls: Array<{ table: unknown }> = [];
let conflictHandled = false;

mock.module("server-only", () => ({}));

mock.module("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (existingBotUser ? [existingBotUser] : []),
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        // Record the insert immediately (drizzle's API allows both awaiting
        // .values(...) directly and chaining .onConflictDoNothing()).
        insertCalls.push({ table, values });
        const promise = Promise.resolve(undefined) as Promise<undefined> & {
          onConflictDoNothing: () => Promise<undefined>;
        };
        promise.onConflictDoNothing = async () => {
          conflictHandled = true;
          return undefined;
        };
        return promise;
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updateCalls.push({ table, values });
          return undefined;
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async () => {
        deleteCalls.push({ table });
        return undefined;
      },
    }),
  },
}));

const usersTable = { id: "users.id", username: "users.username", _: "users" };
const authSessionsTable = {
  id: "authSessions.id",
  _: "authSessions",
};

mock.module("@/lib/db/schema", () => ({
  users: usersTable,
  authSessions: authSessionsTable,
}));

let cookieConfig = {
  name: "better-auth.session_token",
  attributes: { path: "/", secure: false, sameSite: "lax" } as {
    path?: string;
    secure?: boolean;
    sameSite?: string;
  },
};

mock.module("@/lib/auth/config", () => ({
  auth: {
    get $context() {
      return Promise.resolve({
        secret: "test-better-auth-secret",
        authCookies: {
          sessionToken: cookieConfig,
        },
        sessionConfig: {
          expiresIn: 60 * 60 * 24 * 7,
        },
      });
    },
  },
}));

const VALID_SECRET = "a".repeat(64);
const SHORT_SECRET = "a".repeat(32);

const originalEnv = {
  VERCEL_ENV: process.env.VERCEL_ENV,
  NODE_ENV: process.env.NODE_ENV,
  OPEN_AGENTS_TEST_AUTH_SECRET_DO_NOT_SET_IN_PRODUCTION:
    process.env.OPEN_AGENTS_TEST_AUTH_SECRET_DO_NOT_SET_IN_PRODUCTION,
  OPEN_AGENTS_ALLOW_TEST_AUTH_DO_NOT_SET_IN_PRODUCTION:
    process.env.OPEN_AGENTS_ALLOW_TEST_AUTH_DO_NOT_SET_IN_PRODUCTION,
};

function setEnv(values: Partial<typeof originalEnv>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined)
      delete (process.env as Record<string, string>)[key];
    else (process.env as Record<string, string>)[key] = value;
  }
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined)
      delete (process.env as Record<string, string>)[key];
    else (process.env as Record<string, string>)[key] = value;
  }
}

const routeModulePromise = import("./route");

function createRequest(init: {
  body?: unknown;
  headers?: Record<string, string>;
}): NextRequest {
  const headers = new Headers(init.headers ?? {});
  return {
    headers,
    json: async () => init.body ?? {},
  } as unknown as NextRequest;
}

describe("POST /api/dev/session", () => {
  beforeEach(() => {
    existingBotUser = {
      id: "__test_bot__",
      username: "test-bot",
      email: "test-bot@vercel.com",
    };
    insertCalls.length = 0;
    updateCalls.length = 0;
    deleteCalls.length = 0;
    conflictHandled = false;
    setEnv({
      VERCEL_ENV: "preview",
      NODE_ENV: "development",
      OPEN_AGENTS_TEST_AUTH_SECRET_DO_NOT_SET_IN_PRODUCTION: VALID_SECRET,
      OPEN_AGENTS_ALLOW_TEST_AUTH_DO_NOT_SET_IN_PRODUCTION: "true",
    });
  });

  afterEach(() => {
    restoreEnv();
  });

  test("returns 404 in production (VERCEL_ENV=production)", async () => {
    setEnv({ VERCEL_ENV: "production" });
    const { POST } = await routeModulePromise;
    const res = await POST(
      createRequest({ headers: { "x-test-auth": VALID_SECRET } }),
    );
    expect(res.status).toBe(404);
    expect(insertCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
  });

  test("returns 404 in local production builds without ALLOW_TEST_AUTH", async () => {
    setEnv({
      VERCEL_ENV: undefined,
      NODE_ENV: "production",
      OPEN_AGENTS_ALLOW_TEST_AUTH_DO_NOT_SET_IN_PRODUCTION: undefined,
    });
    const { POST } = await routeModulePromise;
    const res = await POST(
      createRequest({ headers: { "x-test-auth": VALID_SECRET } }),
    );
    expect(res.status).toBe(404);
  });

  test("serves local production builds when ALLOW_TEST_AUTH=true", async () => {
    setEnv({
      VERCEL_ENV: undefined,
      NODE_ENV: "production",
      OPEN_AGENTS_ALLOW_TEST_AUTH_DO_NOT_SET_IN_PRODUCTION: "true",
    });
    const { POST } = await routeModulePromise;
    const res = await POST(
      createRequest({ headers: { "x-test-auth": VALID_SECRET } }),
    );
    expect(res.status).toBe(200);
  });

  test("returns 404 when the test auth secret is unset", async () => {
    setEnv({
      OPEN_AGENTS_TEST_AUTH_SECRET_DO_NOT_SET_IN_PRODUCTION: undefined,
    });
    const { POST } = await routeModulePromise;
    const res = await POST(
      createRequest({ headers: { "x-test-auth": "anything" } }),
    );
    expect(res.status).toBe(404);
  });

  test("returns 404 when explicit test auth opt-in is unset", async () => {
    setEnv({
      OPEN_AGENTS_ALLOW_TEST_AUTH_DO_NOT_SET_IN_PRODUCTION: undefined,
    });
    const { POST } = await routeModulePromise;
    const res = await POST(
      createRequest({ headers: { "x-test-auth": VALID_SECRET } }),
    );
    expect(res.status).toBe(404);
  });

  test("returns 404 when the test auth secret is shorter than 64 chars", async () => {
    setEnv({
      OPEN_AGENTS_TEST_AUTH_SECRET_DO_NOT_SET_IN_PRODUCTION: SHORT_SECRET,
    });
    const { POST } = await routeModulePromise;
    const res = await POST(
      createRequest({ headers: { "x-test-auth": SHORT_SECRET } }),
    );
    expect(res.status).toBe(404);
  });

  test("returns 401 when X-Test-Auth header is missing", async () => {
    const { POST } = await routeModulePromise;
    const res = await POST(createRequest({}));
    expect(res.status).toBe(401);
  });

  test("returns 401 when X-Test-Auth header is wrong", async () => {
    const { POST } = await routeModulePromise;
    const res = await POST(
      createRequest({ headers: { "x-test-auth": "b".repeat(64) } }),
    );
    expect(res.status).toBe(401);
  });

  test("returns 401 (not 200) when secret differs only at the end", async () => {
    const wrong = `${VALID_SECRET.slice(0, -1)}b`;
    const { POST } = await routeModulePromise;
    const res = await POST(
      createRequest({ headers: { "x-test-auth": wrong } }),
    );
    expect(res.status).toBe(401);
  });

  test("mints a session for the test bot user (existing)", async () => {
    const { POST } = await routeModulePromise;
    const res = await POST(
      createRequest({ headers: { "x-test-auth": VALID_SECRET } }),
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      cookie: { name: string; value: string };
      header: string;
      token: string;
      expiresAt: string;
      expiresIn: number;
      user: { id: string; username: string };
    };

    expect(body.user).toEqual({ id: "__test_bot__", username: "test-bot" });
    expect(body.cookie.name).toBe("better-auth.session_token");
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(body.cookie.value.startsWith(`${body.token}.`)).toBe(true);
    expect(body.header).toBe(`${body.cookie.name}=${body.cookie.value}`);
    expect(body.expiresIn).toBe(60 * 60 * 24 * 7);
    // Better Auth's cookie reader URL-decodes the value before verifying. The signature
    // is base64 (length 44, ends with "="), and "=" must be URL-encoded as "%3D"
    // in the cookie to match what Better Auth's own signCookieValue emits.
    expect(body.cookie.value.endsWith("%3D")).toBe(true);

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain(body.cookie.value);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Max-Age=604800");
    expect(setCookie).not.toContain("Secure");

    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]?.table).toBe(authSessionsTable);

    // Only the auth_sessions insert should happen (user already exists).
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]?.table).toBe(authSessionsTable);
    const inserted = insertCalls[0]?.values;
    if (!inserted) throw new Error("missing insert call");
    expect(inserted.token).toBe(body.token);
    expect(inserted.userId).toBe("__test_bot__");
    expect(inserted.expiresAt).toBeInstanceOf(Date);
    const ttl =
      (inserted.expiresAt as Date).getTime() -
      (inserted.createdAt as Date).getTime();
    expect(ttl).toBe(60 * 60 * 24 * 7 * 1000);
  });

  test("auto-creates the bot user on first call", async () => {
    existingBotUser = undefined;
    const { POST } = await routeModulePromise;
    const res = await POST(
      createRequest({ headers: { "x-test-auth": VALID_SECRET } }),
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      user: { id: string; username: string };
    };
    expect(body.user).toEqual({ id: "__test_bot__", username: "test-bot" });

    // First call should insert the user (with conflict handling) AND the session.
    expect(insertCalls).toHaveLength(2);
    expect(conflictHandled).toBe(true);
    expect(insertCalls[0]?.table).toBe(usersTable);
    expect(insertCalls[0]?.values.id).toBe("__test_bot__");
    expect(insertCalls[0]?.values.username).toBe("test-bot");
    expect(insertCalls[0]?.values.email).toBe("test-bot@vercel.com");
    expect(insertCalls[1]?.table).toBe(authSessionsTable);
    expect(insertCalls[1]?.values.userId).toBe("__test_bot__");
  });

  test("backfills the bot's email if it is missing on an existing row", async () => {
    existingBotUser = {
      id: "__test_bot__",
      username: "test-bot",
      email: null,
    };
    const { POST } = await routeModulePromise;
    const res = await POST(
      createRequest({ headers: { "x-test-auth": VALID_SECRET } }),
    );
    expect(res.status).toBe(200);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.table).toBe(usersTable);
    expect(updateCalls[0]?.values.email).toBe("test-bot@vercel.com");
    expect(updateCalls[0]?.values.emailVerified).toBe(true);
  });

  test("does not update when the bot's email already matches", async () => {
    // existingBotUser is set in beforeEach with the correct email.
    const { POST } = await routeModulePromise;
    const res = await POST(
      createRequest({ headers: { "x-test-auth": VALID_SECRET } }),
    );
    expect(res.status).toBe(200);
    expect(updateCalls).toHaveLength(0);
  });

  test("ignores any handle in the request body", async () => {
    const { POST } = await routeModulePromise;
    const res = await POST(
      createRequest({
        body: { handle: "nico" },
        headers: { "x-test-auth": VALID_SECRET },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { id: string; username: string };
    };
    // The handle was ignored — the bot user is the only impersonatable identity.
    expect(body.user.id).toBe("__test_bot__");
    expect(body.user.username).toBe("test-bot");
  });

  test("emits Secure when auth cookie attrs request it", async () => {
    cookieConfig = {
      name: "__Secure-better-auth.session_token",
      attributes: { path: "/", secure: true, sameSite: "lax" },
    };
    try {
      const { POST } = await routeModulePromise;
      const res = await POST(
        createRequest({ headers: { "x-test-auth": VALID_SECRET } }),
      );
      expect(res.status).toBe(200);
      const setCookie = res.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain("Secure");
      expect(setCookie.startsWith("__Secure-better-auth.session_token=")).toBe(
        true,
      );
    } finally {
      cookieConfig = {
        name: "better-auth.session_token",
        attributes: { path: "/", secure: false, sameSite: "lax" },
      };
    }
  });
});
