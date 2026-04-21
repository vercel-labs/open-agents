import { describe, expect, test } from "bun:test";
import {
  MERGE_READINESS_TRANSIENT_MAX_POLLS,
  shouldIncrementMergeReadinessTransientPollCount,
  shouldPollMergeReadiness,
} from "./merge-readiness-polling";

const baseReadiness = {
  canMerge: false,
  reasons: [] as string[],
  pr: { number: 42 },
  checkRuns: [] as unknown[],
  checks: {
    requiredTotal: 0,
    pending: 0,
    failed: 0,
  },
};

describe("merge readiness polling", () => {
  test("keeps polling while required checks are pending", () => {
    expect(
      shouldPollMergeReadiness({
        readiness: {
          ...baseReadiness,
          checks: {
            requiredTotal: 2,
            pending: 1,
            failed: 0,
          },
        },
        transientPollCount: MERGE_READINESS_TRANSIENT_MAX_POLLS,
      }),
    ).toBe(true);
  });

  test("warm-up polls when GitHub has not surfaced checks yet", () => {
    expect(
      shouldPollMergeReadiness({
        readiness: {
          ...baseReadiness,
          reasons: ["Branch protection requirements are not yet satisfied"],
        },
        transientPollCount: 0,
      }),
    ).toBe(true);
  });

  test("keeps polling briefly when all checks passed but mergeability is stale", () => {
    expect(
      shouldPollMergeReadiness({
        readiness: {
          ...baseReadiness,
          reasons: ["Branch protection requirements are not yet satisfied"],
          checkRuns: [{ id: 1 }],
          checks: {
            requiredTotal: 1,
            pending: 0,
            failed: 0,
          },
        },
        transientPollCount: 0,
      }),
    ).toBe(true);
  });

  test("stops transient polling after the retry budget is exhausted", () => {
    expect(
      shouldPollMergeReadiness({
        readiness: {
          ...baseReadiness,
          reasons: ["GitHub is still calculating mergeability"],
        },
        transientPollCount: MERGE_READINESS_TRANSIENT_MAX_POLLS,
      }),
    ).toBe(false);
  });

  test("does not keep polling when checks are failing", () => {
    expect(
      shouldPollMergeReadiness({
        readiness: {
          ...baseReadiness,
          reasons: ["Branch protection requirements are not yet satisfied"],
          checkRuns: [{ id: 1 }],
          checks: {
            requiredTotal: 1,
            pending: 0,
            failed: 1,
          },
        },
        transientPollCount: 0,
      }),
    ).toBe(false);
  });

  test("increments the transient poll count only while waiting on transient readiness", () => {
    expect(
      shouldIncrementMergeReadinessTransientPollCount({
        ...baseReadiness,
        reasons: ["Branch protection requirements are not yet satisfied"],
        checkRuns: [{ id: 1 }],
        checks: {
          requiredTotal: 1,
          pending: 0,
          failed: 0,
        },
      }),
    ).toBe(true);

    expect(
      shouldIncrementMergeReadinessTransientPollCount({
        ...baseReadiness,
        reasons: ["Required checks are still pending"],
        checks: {
          requiredTotal: 1,
          pending: 1,
          failed: 0,
        },
      }),
    ).toBe(false);
  });

  test("does not poll for stable blocked states without transient signals", () => {
    expect(
      shouldPollMergeReadiness({
        readiness: {
          ...baseReadiness,
          reasons: ["Pull request has merge conflicts"],
        },
        transientPollCount: 0,
      }),
    ).toBe(false);
  });
});
