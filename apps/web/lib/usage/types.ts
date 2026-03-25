export interface UsagePrInsights {
  trackedPrCount: number;
  sessionsWithPrCount: number;
  openPrCount: number;
  mergedPrCount: number;
  closedPrCount: number;
  mergeRate: number;
}

export interface UsageEfficiencyInsights {
  mainAssistantTurnCount: number;
  averageTokensPerMainTurn: number;
  largestMainTurnTokens: number;
  toolCallsPerMainTurn: number;
  cacheReadRatio: number;
}

export interface UsageCodeInsights {
  linesAdded: number;
  linesRemoved: number;
  totalLinesChanged: number;
}

export interface UsageRepositoryInsight {
  repoOwner: string;
  repoName: string;
  sessionCount: number;
  trackedPrCount: number;
  linesAdded: number;
  linesRemoved: number;
  totalLinesChanged: number;
}

export interface UsageDomainLeaderboardRow {
  userId: string;
  username: string;
  name: string | null;
  totalTokens: number;
  mostUsedModelId: string | null;
  mostUsedModelTokens: number;
}

export interface UsageDomainLeaderboard {
  domain: string;
  rows: UsageDomainLeaderboardRow[];
}

export interface UsageInsights {
  lookbackDays: number;
  pr: UsagePrInsights;
  efficiency: UsageEfficiencyInsights;
  code: UsageCodeInsights;
  topRepositories: UsageRepositoryInsight[];
}
