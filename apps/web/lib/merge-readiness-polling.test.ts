import { describe, expect, test } from "bun:test";
import {
  MERGE_READINESS_EMPTY_CHECKS_MAX_POLLS,
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
          },
        },
        emptyChecksPollCount: MERGE_READINESS_EMPTY_CHECKS_MAX_POLLS,
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
        emptyChecksPollCount: 0,
      }),
    ).toBe(true);
  });

  test("stops warm-up polling after the retry budget is exhausted", () => {
    expect(
      shouldPollMergeReadiness({
        readiness: {
          ...baseReadiness,
          reasons: ["GitHub is still calculating mergeability"],
        },
        emptyChecksPollCount: MERGE_READINESS_EMPTY_CHECKS_MAX_POLLS,
      }),
    ).toBe(false);
  });

  test("stops warm-up polling once checks materialize", () => {
    expect(
      shouldPollMergeReadiness({
        readiness: {
          ...baseReadiness,
          reasons: ["Branch protection requirements are not yet satisfied"],
          checkRuns: [{ id: 1 }],
        },
        emptyChecksPollCount: 0,
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
        emptyChecksPollCount: 0,
      }),
    ).toBe(false);
  });
});
