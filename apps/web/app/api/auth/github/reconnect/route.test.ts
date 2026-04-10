import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { NextRequest } from "next/server";

const routeModulePromise = import("./route");

const originalNodeEnv = process.env.NODE_ENV;

function createRequest(url: string): NextRequest {
  return {
    url,
    nextUrl: new URL(url),
  } as NextRequest;
}

describe("GET /api/auth/github/reconnect", () => {
  beforeEach(() => {
    Object.assign(process.env, { NODE_ENV: "test" });
  });

  afterEach(() => {
    Object.assign(process.env, { NODE_ENV: originalNodeEnv });
  });

  test("sets reconnect mode and redirects into the install flow", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      createRequest(
        "http://localhost/api/auth/github/reconnect?next=/sessions",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost/api/github/app/install?next=%2Fsessions",
    );

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("github_reconnect=1");
  });
});
