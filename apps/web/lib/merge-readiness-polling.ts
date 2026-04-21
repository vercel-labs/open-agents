const TRANSIENT_MERGE_READINESS_REASONS = new Set([
  "GitHub is still calculating mergeability",
  "Required checks are still pending",
  "Required checks are still in progress",
  "Branch protection requirements are not yet satisfied",
]);

export const MERGE_READINESS_POLL_INTERVAL_MS = 5_000;
export const MERGE_READINESS_TRANSIENT_MAX_POLLS = 6;

type MergeReadinessPollingState = {
  canMerge: boolean;
  reasons: string[];
  pr: { number: number } | null;
  checkRuns: unknown[];
  checks: {
    requiredTotal: number;
    pending: number;
    failed: number;
  };
};

function hasTransientMergeReadinessReason(
  readiness: MergeReadinessPollingState,
): boolean {
  return readiness.reasons.some((reason) =>
    TRANSIENT_MERGE_READINESS_REASONS.has(reason),
  );
}

export function shouldIncrementMergeReadinessTransientPollCount(
  readiness: MergeReadinessPollingState | null,
): boolean {
  if (
    !readiness ||
    readiness.canMerge ||
    readiness.checks.pending > 0 ||
    readiness.checks.failed > 0
  ) {
    return false;
  }

  return hasTransientMergeReadinessReason(readiness);
}

export function shouldPollMergeReadiness(params: {
  readiness: MergeReadinessPollingState | null;
  transientPollCount: number;
}): boolean {
  const { readiness, transientPollCount } = params;

  if (!readiness?.pr) {
    return false;
  }

  if (readiness.checks.pending > 0) {
    return true;
  }

  if (
    readiness.canMerge ||
    readiness.checks.failed > 0 ||
    !hasTransientMergeReadinessReason(readiness)
  ) {
    return false;
  }

  return transientPollCount < MERGE_READINESS_TRANSIENT_MAX_POLLS;
}
