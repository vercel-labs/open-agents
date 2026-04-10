import { describe, expect, test } from "bun:test";
import { formatTokens } from "./tool-state";

describe("formatTokens", () => {
  test("returns raw number for values under 1,000", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(1)).toBe("1");
    expect(formatTokens(999)).toBe("999");
  });

  test("formats thousands with k suffix", () => {
    expect(formatTokens(1_000)).toBe("1.0k");
    expect(formatTokens(1_200)).toBe("1.2k");
    expect(formatTokens(15_800)).toBe("15.8k");
    expect(formatTokens(999_999)).toBe("1000.0k");
  });

  test("formats millions with m suffix", () => {
    expect(formatTokens(1_000_000)).toBe("1.0m");
    expect(formatTokens(1_005_000)).toBe("1.0m");
    expect(formatTokens(2_500_000)).toBe("2.5m");
    expect(formatTokens(999_999_999)).toBe("1000.0m");
  });

  test("formats billions with b suffix", () => {
    expect(formatTokens(1_000_000_000)).toBe("1.0b");
    expect(formatTokens(2_500_000_000)).toBe("2.5b");
    expect(formatTokens(10_000_000_000)).toBe("10.0b");
  });

  test("never produces values like 1000k or 1000m", () => {
    // These are the exact bug cases — values just above the boundary
    // should use the higher unit, not produce "1005k"
    const result1005k = formatTokens(1_005_000);
    expect(result1005k).toBe("1.0m");
    expect(result1005k).not.toContain("1005");

    const result1000k = formatTokens(1_000_000);
    expect(result1000k).toBe("1.0m");
    expect(result1000k).not.toContain("1000k");

    const result1000m = formatTokens(1_000_000_000);
    expect(result1000m).toBe("1.0b");
    expect(result1000m).not.toContain("1000m");
  });
});
