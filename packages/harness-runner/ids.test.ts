import { describe, expect, test } from "bun:test";
import { EXTERNAL_HARNESS_IDS, isExternalHarnessId } from "./ids.ts";

describe("isExternalHarnessId", () => {
  test("accepts every external harness id", () => {
    for (const harnessId of EXTERNAL_HARNESS_IDS) {
      expect(isExternalHarnessId(harnessId)).toBeTrue();
    }
  });

  test("rejects the open-agent loop and unknown values", () => {
    expect(isExternalHarnessId("open-agent")).toBeFalse();
    expect(isExternalHarnessId("goose")).toBeFalse();
    expect(isExternalHarnessId(undefined)).toBeFalse();
  });
});
