const TRANSIENT_MERGE_READINESS_REASONS = new Set([
  "GitHub is still calculating mergeability",
  "Required checks are still pending",
  "Required checks are still in progress",
  "Branch protection requirements are not yet satisfied",
]);

export const MERGE_READINESS_POLL_INTERVAL_MS = 5_000;
export const MERGE_READINESS_EMPTY_CHECKS_MAX_POLLS = 6;

type MergeReadinessPollingState = {
  canMerge: boolean;
  reasons: string[];
  pr: { number: number } | null;
  checkRuns: unknown[];
  checks: {
    requiredTotal: number;
    pending: number;
  };
};

export function shouldPollMergeReadiness(params: {
  readiness: MergeReadinessPollingState | null;
  emptyChecksPollCount: number;
}): boolean {
  const { readiness, emptyChecksPollCount } = params;

  if (!readiness?.pr) {
    return false;
  }

  if (readiness.checks.pending > 0) {
    return true;
  }

  if (readiness.canMerge) {
    return false;
  }

  if (
    readiness.checks.requiredTotal > 0 ||
    readiness.checkRuns.length > 0 ||
    emptyChecksPollCount >= MERGE_READINESS_EMPTY_CHECKS_MAX_POLLS
  ) {
    return false;
  }

  return readiness.reasons.some((reason) =>
    TRANSIENT_MERGE_READINESS_REASONS.has(reason),
  );
}
