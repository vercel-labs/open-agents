import { describe, expect, test } from "bun:test";
import type { SessionWithUnread } from "@/hooks/use-sessions";
import { matchesSessionQuery } from "./inbox-sidebar-search";

function makeSession(
  overrides: Partial<SessionWithUnread> = {},
): SessionWithUnread {
  return {
    id: "session-1",
    title: "Add sidebar filter",
    status: "idle",
    repoOwner: "vercel-labs",
    repoName: "open-agents",
    branch: "main",
    linesAdded: null,
    linesRemoved: null,
    prNumber: null,
    prStatus: null,
    createdAt: new Date("2026-04-13T00:00:00Z"),
    hasUnread: false,
    hasStreaming: false,
    latestChatId: null,
    lastActivityAt: new Date("2026-04-13T00:00:00Z"),
    ...overrides,
  } as SessionWithUnread;
}

describe("matchesSessionQuery", () => {
  test("returns true for empty query", () => {
    expect(matchesSessionQuery(makeSession(), "")).toBe(true);
  });

  test("returns true for whitespace-only query", () => {
    expect(matchesSessionQuery(makeSession(), "   ")).toBe(true);
  });

  test("matches session title case-insensitively", () => {
    expect(matchesSessionQuery(makeSession(), "SIDEBAR")).toBe(true);
    expect(matchesSessionQuery(makeSession(), "filter")).toBe(true);
  });

  test("matches by trimming whitespace around query", () => {
    expect(matchesSessionQuery(makeSession(), "  sidebar  ")).toBe(true);
  });

  test("matches repo owner and name", () => {
    expect(matchesSessionQuery(makeSession(), "vercel")).toBe(true);
    expect(matchesSessionQuery(makeSession(), "open-agents")).toBe(true);
  });

  test("matches branch name", () => {
    expect(
      matchesSessionQuery(makeSession({ branch: "feat/xyz" }), "xyz"),
    ).toBe(true);
  });

  test("returns false for unrelated query", () => {
    expect(matchesSessionQuery(makeSession(), "unrelated")).toBe(false);
  });

  test("ignores sessions with missing optional fields", () => {
    const session = makeSession({
      repoOwner: null,
      repoName: null,
      branch: null,
    });
    expect(matchesSessionQuery(session, "sidebar")).toBe(true);
    expect(matchesSessionQuery(session, "vercel")).toBe(false);
  });
});
