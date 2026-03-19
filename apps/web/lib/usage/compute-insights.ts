import type { UsageInsights, UsageRepositoryInsight } from "./types";

export interface UsageAggregateRow {
  totalInputTokens: number;
  totalCachedInputTokens: number;
  totalOutputTokens: number;
  totalToolCallCount: number;
  mainInputTokens: number;
  mainOutputTokens: number;
  mainAssistantTurnCount: number;
  largestMainTurnTokens: number;
}

export interface UsageSessionInsightRow {
  repoOwner: string | null;
  repoName: string | null;
  prNumber: number | null;
  prStatus: "open" | "merged" | "closed" | null;
  linesAdded: number | null;
  linesRemoved: number | null;
  updatedAt: Date;
}

interface BuildUsageInsightsParams {
  lookbackDays: number;
  aggregate: UsageAggregateRow;
  sessions: UsageSessionInsightRow[];
  topRepositoryLimit?: number;
}

interface MutableRepoInsight {
  repoOwner: string;
  repoName: string;
  sessionCount: number;
  linesAdded: number;
  linesRemoved: number;
  trackedPrNumbers: Set<number>;
}

interface TrackedPrRecord {
  status: "open" | "merged" | "closed" | null;
  updatedAt: Date;
}

const toNonNegativeNumber = (value: number | null | undefined): number => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, value);
};

const clampRatio = (numerator: number, denominator: number): number => {
  if (denominator <= 0) {
    return 0;
  }

  const ratio = numerator / denominator;
  return Math.max(0, Math.min(1, ratio));
};

function buildTopRepositories(
  sessions: UsageSessionInsightRow[],
  limit: number,
): UsageRepositoryInsight[] {
  const repoMap = new Map<string, MutableRepoInsight>();

  for (const session of sessions) {
    if (!session.repoOwner || !session.repoName) {
      continue;
    }

    const repoKey = `${session.repoOwner.toLowerCase()}/${session.repoName.toLowerCase()}`;
    const existing = repoMap.get(repoKey);

    if (existing) {
      existing.sessionCount += 1;
      existing.linesAdded += toNonNegativeNumber(session.linesAdded);
      existing.linesRemoved += toNonNegativeNumber(session.linesRemoved);
      if (session.prNumber !== null) {
        existing.trackedPrNumbers.add(session.prNumber);
      }
      continue;
    }

    repoMap.set(repoKey, {
      repoOwner: session.repoOwner,
      repoName: session.repoName,
      sessionCount: 1,
      linesAdded: toNonNegativeNumber(session.linesAdded),
      linesRemoved: toNonNegativeNumber(session.linesRemoved),
      trackedPrNumbers:
        session.prNumber !== null ? new Set([session.prNumber]) : new Set(),
    });
  }

  return [...repoMap.values()]
    .map((repo) => {
      const totalLinesChanged = repo.linesAdded + repo.linesRemoved;
      return {
        repoOwner: repo.repoOwner,
        repoName: repo.repoName,
        sessionCount: repo.sessionCount,
        trackedPrCount: repo.trackedPrNumbers.size,
        linesAdded: repo.linesAdded,
        linesRemoved: repo.linesRemoved,
        totalLinesChanged,
      } satisfies UsageRepositoryInsight;
    })
    .toSorted((a, b) => {
      if (b.trackedPrCount !== a.trackedPrCount) {
        return b.trackedPrCount - a.trackedPrCount;
      }
      if (b.totalLinesChanged !== a.totalLinesChanged) {
        return b.totalLinesChanged - a.totalLinesChanged;
      }
      if (b.sessionCount !== a.sessionCount) {
        return b.sessionCount - a.sessionCount;
      }
      if (a.repoOwner !== b.repoOwner) {
        return a.repoOwner.localeCompare(b.repoOwner);
      }
      return a.repoName.localeCompare(b.repoName);
    })
    .slice(0, limit);
}

function summarizePullRequests(sessions: UsageSessionInsightRow[]) {
  const trackedPrMap = new Map<string, TrackedPrRecord>();
  let sessionsWithPrCount = 0;

  for (const session of sessions) {
    if (session.prNumber === null) {
      continue;
    }

    sessionsWithPrCount += 1;

    if (!session.repoOwner || !session.repoName) {
      continue;
    }

    const key = `${session.repoOwner.toLowerCase()}/${session.repoName.toLowerCase()}#${session.prNumber}`;
    const existing = trackedPrMap.get(key);
    if (!existing || session.updatedAt > existing.updatedAt) {
      trackedPrMap.set(key, {
        status: session.prStatus,
        updatedAt: session.updatedAt,
      });
    }
  }

  let openPrCount = 0;
  let mergedPrCount = 0;
  let closedPrCount = 0;

  for (const trackedPr of trackedPrMap.values()) {
    if (trackedPr.status === "merged") {
      mergedPrCount += 1;
      continue;
    }

    if (trackedPr.status === "closed") {
      closedPrCount += 1;
      continue;
    }

    openPrCount += 1;
  }

  const trackedPrCount = trackedPrMap.size;

  return {
    trackedPrCount,
    sessionsWithPrCount,
    openPrCount,
    mergedPrCount,
    closedPrCount,
    mergeRate: trackedPrCount > 0 ? mergedPrCount / trackedPrCount : 0,
  };
}

function summarizeCodeChurn(sessions: UsageSessionInsightRow[]) {
  const linesAdded = sessions.reduce(
    (sum, session) => sum + toNonNegativeNumber(session.linesAdded),
    0,
  );
  const linesRemoved = sessions.reduce(
    (sum, session) => sum + toNonNegativeNumber(session.linesRemoved),
    0,
  );

  return {
    linesAdded,
    linesRemoved,
    totalLinesChanged: linesAdded + linesRemoved,
  };
}

export function buildUsageInsights(
  params: BuildUsageInsightsParams,
): UsageInsights {
  const topRepositoryLimit = params.topRepositoryLimit ?? 5;
  const mainAssistantTurnCount = toNonNegativeNumber(
    params.aggregate.mainAssistantTurnCount,
  );
  const mainTokens =
    toNonNegativeNumber(params.aggregate.mainInputTokens) +
    toNonNegativeNumber(params.aggregate.mainOutputTokens);
  const totalInputTokens = toNonNegativeNumber(
    params.aggregate.totalInputTokens,
  );
  const totalCachedInputTokens = toNonNegativeNumber(
    params.aggregate.totalCachedInputTokens,
  );
  const totalToolCallCount = toNonNegativeNumber(
    params.aggregate.totalToolCallCount,
  );

  return {
    lookbackDays: params.lookbackDays,
    pr: summarizePullRequests(params.sessions),
    efficiency: {
      mainAssistantTurnCount,
      averageTokensPerMainTurn:
        mainAssistantTurnCount > 0 ? mainTokens / mainAssistantTurnCount : 0,
      largestMainTurnTokens: toNonNegativeNumber(
        params.aggregate.largestMainTurnTokens,
      ),
      toolCallsPerMainTurn:
        mainAssistantTurnCount > 0
          ? totalToolCallCount / mainAssistantTurnCount
          : 0,
      cacheReadRatio: clampRatio(totalCachedInputTokens, totalInputTokens),
    },
    code: summarizeCodeChurn(params.sessions),
    topRepositories: buildTopRepositories(params.sessions, topRepositoryLimit),
  };
}
