import { describe, expect, test } from "bun:test";
import {
  buildUsageDomainLeaderboardRows,
  getUsageLeaderboardDomain,
} from "./usage-domain-leaderboard";

describe("getUsageLeaderboardDomain", () => {
  test("accepts verified internal domains", () => {
    expect(getUsageLeaderboardDomain("Alice@Vercel.com")).toBe("vercel.com");
  });

  test("rejects personal and unverified domains", () => {
    expect(getUsageLeaderboardDomain("alice@gmail.com")).toBeNull();
    expect(getUsageLeaderboardDomain("alice@hotmail.com")).toBeNull();
    expect(getUsageLeaderboardDomain("alice@example.com")).toBeNull();
    expect(getUsageLeaderboardDomain("missing-at-symbol")).toBeNull();
    expect(getUsageLeaderboardDomain(undefined)).toBeNull();
  });
});

describe("buildUsageDomainLeaderboardRows", () => {
  test("aggregates total tokens per user and derives the top model without exposing emails", () => {
    const rows = buildUsageDomainLeaderboardRows([
      {
        userId: "user-1",
        email: "alice@vercel.com",
        username: "alice",
        name: "Alice",
        modelId: "anthropic/claude-sonnet-4",
        totalInputTokens: 80,
        totalOutputTokens: 20,
      },
      {
        userId: "user-1",
        email: "alice@vercel.com",
        username: "alice",
        name: "Alice",
        modelId: "openai/gpt-5",
        totalInputTokens: 40,
        totalOutputTokens: 20,
      },
      {
        userId: "user-2",
        email: "bob@vercel.com",
        username: "bob",
        name: null,
        modelId: null,
        totalInputTokens: 70,
        totalOutputTokens: 20,
      },
      {
        userId: "user-3",
        email: null,
        username: "ignored",
        name: null,
        modelId: "openai/gpt-5",
        totalInputTokens: 999,
        totalOutputTokens: 999,
      },
      {
        userId: "user-4",
        email: "zero@vercel.com",
        username: "zero",
        name: null,
        modelId: "openai/gpt-5",
        totalInputTokens: 0,
        totalOutputTokens: 0,
      },
    ]);

    expect(rows).toEqual([
      {
        userId: "user-1",
        username: "alice",
        name: "Alice",
        totalTokens: 160,
        mostUsedModelId: "anthropic/claude-sonnet-4",
        mostUsedModelTokens: 100,
      },
      {
        userId: "user-2",
        username: "bob",
        name: null,
        totalTokens: 90,
        mostUsedModelId: null,
        mostUsedModelTokens: 90,
      },
    ]);
    expect(rows[0]).not.toHaveProperty("email");
  });

  test("prefers a known model over unknown when token totals tie", () => {
    const [row] = buildUsageDomainLeaderboardRows([
      {
        userId: "user-1",
        email: "alice@vercel.com",
        username: "alice",
        name: "Alice",
        modelId: null,
        totalInputTokens: 50,
        totalOutputTokens: 0,
      },
      {
        userId: "user-1",
        email: "alice@vercel.com",
        username: "alice",
        name: "Alice",
        modelId: "openai/gpt-5",
        totalInputTokens: 40,
        totalOutputTokens: 10,
      },
    ]);

    expect(row).toEqual({
      userId: "user-1",
      username: "alice",
      name: "Alice",
      totalTokens: 100,
      mostUsedModelId: "openai/gpt-5",
      mostUsedModelTokens: 50,
    });
  });
});
