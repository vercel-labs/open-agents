import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

let sessionRecord: { userId: string } | null = null;
let chats: Array<{ id: string }> = [];
let userRecord: { name: string | null; username: string | null } | null = null;
let githubAccount: { username: string } | null = null;

const originalVercelUrl = process.env.VERCEL_URL;
const originalVercelEnv = process.env.VERCEL_ENV;
const originalProductionUrl =
  process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL;

function restoreEnv() {
  if (originalVercelUrl === undefined) {
    delete process.env.VERCEL_URL;
  } else {
    process.env.VERCEL_URL = originalVercelUrl;
  }

  if (originalVercelEnv === undefined) {
    delete process.env.VERCEL_ENV;
  } else {
    process.env.VERCEL_ENV = originalVercelEnv;
  }

  if (originalProductionUrl === undefined) {
    delete process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL;
  } else {
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL =
      originalProductionUrl;
  }
}

mock.module("@/app/api/generate-pr/_lib/generate-pr-helpers", () => ({
  getConversationContext: async () => "",
}));

mock.module("@/lib/db/sessions", () => ({
  getSessionById: async () => sessionRecord,
  getChatsBySessionId: async () => chats,
}));

mock.module("@/lib/db/accounts", () => ({
  getGitHubAccount: async () => githubAccount,
}));

mock.module("@/lib/db/client", () => ({
  db: {
    query: {
      users: {
        findFirst: async () => userRecord,
      },
    },
  },
}));

const prContentModulePromise = import("./pr-content");

describe("pr-content", () => {
  beforeEach(() => {
    sessionRecord = null;
    chats = [];
    userRecord = null;
    githubAccount = null;
    restoreEnv();
  });

  afterEach(() => {
    restoreEnv();
  });

  test("resolvePullRequestContextSection returns a single-line footer with chat link and attribution", async () => {
    const { resolvePullRequestContextSection } = await prContentModulePromise;

    sessionRecord = { userId: "user-1" };
    chats = [{ id: "chat-2" }, { id: "chat-1" }];
    userRecord = { name: "Nico Albanese", username: "nico" };
    githubAccount = { username: "nicoalbanese10" };

    const section = await resolvePullRequestContextSection({
      sessionId: "session-1",
      appBaseUrl: "https://openharness.dev",
    });

    expect(section).toBe(
      "[OpenHarness Chat](https://openharness.dev/sessions/session-1/chats/chat-2) - Built with guidance from [Nico Albanese](https://github.com/nicoalbanese10)",
    );
  });

  test("resolvePullRequestContextSection falls back to plain-text attribution when no GitHub account exists", async () => {
    const { resolvePullRequestContextSection } = await prContentModulePromise;

    sessionRecord = { userId: "user-1" };
    userRecord = { name: null, username: "nico" };

    const section = await resolvePullRequestContextSection({
      sessionId: "session-1",
    });

    expect(section).toBe("Built with guidance from nico");
  });

  test("resolvePullRequestAppBaseUrl prefers the active deployment url", async () => {
    const { resolvePullRequestAppBaseUrl } = await prContentModulePromise;

    process.env.VERCEL_URL = "preview-openharness.vercel.app";
    process.env.VERCEL_ENV = "preview";
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL = "openharness.dev";

    expect(resolvePullRequestAppBaseUrl()).toBe(
      "https://preview-openharness.vercel.app",
    );

    delete process.env.VERCEL_URL;
    process.env.VERCEL_ENV = "production";

    expect(resolvePullRequestAppBaseUrl()).toBe("https://openharness.dev");
  });

  test("appendPullRequestContextSection appends the footer after a horizontal rule", async () => {
    const { appendPullRequestContextSection } = await prContentModulePromise;

    expect(
      appendPullRequestContextSection(
        "## Summary\n\nInitial body\n",
        "[OpenHarness Chat](https://example.com) - Built with guidance from Nico",
      ),
    ).toBe(`## Summary

Initial body

---

[OpenHarness Chat](https://example.com) - Built with guidance from Nico`);
  });
});
