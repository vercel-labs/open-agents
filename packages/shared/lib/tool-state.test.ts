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
    expect(formatTokens(500_000)).toBe("500.0k");
  });

  test("formats millions with m suffix", () => {
    expect(formatTokens(1_000_000)).toBe("1.0m");
    expect(formatTokens(1_005_000)).toBe("1.0m");
    expect(formatTokens(2_500_000)).toBe("2.5m");
    expect(formatTokens(150_000_000)).toBe("150.0m");
  });

  test("formats billions with b suffix", () => {
    expect(formatTokens(1_000_000_000)).toBe("1.0b");
    expect(formatTokens(2_500_000_000)).toBe("2.5b");
    expect(formatTokens(10_000_000_000)).toBe("10.0b");
  });

  test("promotes to next tier at rounding boundary instead of showing 1000.0x", () => {
    // 999,950 / 1000 = 999.95, which .toFixed(1) rounds to "1000.0"
    // Should promote to "1.0m" instead of "1000.0k"
    expect(formatTokens(999_950)).toBe("1.0m");
    expect(formatTokens(999_999)).toBe("1.0m");

    // Same boundary for m → b
    expect(formatTokens(999_950_000)).toBe("1.0b");
    expect(formatTokens(999_999_999)).toBe("1.0b");

    // Values just below the rounding boundary stay in the lower tier
    expect(formatTokens(999_949)).toBe("999.9k");
    expect(formatTokens(999_949_999)).toBe("999.9m");
  });

  test("never produces values like 1000k or 1000m", () => {
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
