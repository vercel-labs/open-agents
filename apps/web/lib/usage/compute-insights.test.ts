import { describe, expect, test } from "bun:test";
import { buildUsageInsights } from "./compute-insights";

describe("buildUsageInsights", () => {
  test("computes PR, efficiency, code churn, and repository metrics", () => {
    const insights = buildUsageInsights({
      lookbackDays: 280,
      aggregate: {
        totalInputTokens: 1000,
        totalCachedInputTokens: 250,
        totalOutputTokens: 600,
        totalToolCallCount: 30,
        mainInputTokens: 400,
        mainOutputTokens: 200,
        mainAssistantTurnCount: 10,
        largestMainTurnTokens: 120,
      },
      sessions: [
        {
          repoOwner: "acme",
          repoName: "app",
          prNumber: 101,
          prStatus: "merged",
          linesAdded: 100,
          linesRemoved: 20,
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
        {
          repoOwner: "acme",
          repoName: "app",
          prNumber: 101,
          prStatus: "open",
          linesAdded: 30,
          linesRemoved: 5,
          updatedAt: new Date("2026-01-10T00:00:00.000Z"),
        },
        {
          repoOwner: "acme",
          repoName: "app",
          prNumber: 202,
          prStatus: "closed",
          linesAdded: 20,
          linesRemoved: 8,
          updatedAt: new Date("2026-01-11T00:00:00.000Z"),
        },
        {
          repoOwner: "acme",
          repoName: "docs",
          prNumber: null,
          prStatus: null,
          linesAdded: 50,
          linesRemoved: 10,
          updatedAt: new Date("2026-01-12T00:00:00.000Z"),
        },
        {
          repoOwner: null,
          repoName: null,
          prNumber: 303,
          prStatus: "merged",
          linesAdded: 7,
          linesRemoved: 2,
          updatedAt: new Date("2026-01-13T00:00:00.000Z"),
        },
      ],
      topRepositoryLimit: 5,
    });

    expect(insights.pr).toEqual({
      trackedPrCount: 2,
      sessionsWithPrCount: 4,
      openPrCount: 1,
      mergedPrCount: 0,
      closedPrCount: 1,
      mergeRate: 0,
    });

    expect(insights.efficiency).toEqual({
      mainAssistantTurnCount: 10,
      averageTokensPerMainTurn: 60,
      largestMainTurnTokens: 120,
      toolCallsPerMainTurn: 3,
      cacheReadRatio: 0.25,
    });

    expect(insights.code).toEqual({
      linesAdded: 207,
      linesRemoved: 45,
      totalLinesChanged: 252,
    });

    expect(insights.topRepositories).toEqual([
      {
        repoOwner: "acme",
        repoName: "app",
        sessionCount: 3,
        trackedPrCount: 2,
        linesAdded: 150,
        linesRemoved: 33,
        totalLinesChanged: 183,
      },
      {
        repoOwner: "acme",
        repoName: "docs",
        sessionCount: 1,
        trackedPrCount: 0,
        linesAdded: 50,
        linesRemoved: 10,
        totalLinesChanged: 60,
      },
    ]);
  });

  test("returns zeroed metrics for empty inputs", () => {
    const insights = buildUsageInsights({
      lookbackDays: 280,
      aggregate: {
        totalInputTokens: 0,
        totalCachedInputTokens: 0,
        totalOutputTokens: 0,
        totalToolCallCount: 0,
        mainInputTokens: 0,
        mainOutputTokens: 0,
        mainAssistantTurnCount: 0,
        largestMainTurnTokens: 0,
      },
      sessions: [],
    });

    expect(insights.pr).toEqual({
      trackedPrCount: 0,
      sessionsWithPrCount: 0,
      openPrCount: 0,
      mergedPrCount: 0,
      closedPrCount: 0,
      mergeRate: 0,
    });

    expect(insights.efficiency).toEqual({
      mainAssistantTurnCount: 0,
      averageTokensPerMainTurn: 0,
      largestMainTurnTokens: 0,
      toolCallsPerMainTurn: 0,
      cacheReadRatio: 0,
    });

    expect(insights.code).toEqual({
      linesAdded: 0,
      linesRemoved: 0,
      totalLinesChanged: 0,
    });
    expect(insights.topRepositories).toEqual([]);
  });
});
