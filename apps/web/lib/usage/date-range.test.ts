import { describe, expect, test } from "bun:test";
import {
  formatDateOnly,
  getDateRangeDaysInclusive,
  parseUsageDateRange,
} from "./date-range";

describe("usage date range helpers", () => {
  test("formatDateOnly returns YYYY-MM-DD", () => {
    expect(formatDateOnly(new Date("2026-02-03T15:00:00.000Z"))).toBe(
      "2026-02-03",
    );
  });

  test("parseUsageDateRange accepts a valid range", () => {
    expect(
      parseUsageDateRange({ from: "2026-01-01", to: "2026-01-31" }),
    ).toEqual({
      ok: true,
      range: { from: "2026-01-01", to: "2026-01-31" },
    });
  });

  test("parseUsageDateRange rejects missing params", () => {
    const result = parseUsageDateRange({ from: "2026-01-01", to: null });
    expect(result.ok).toBe(false);
  });

  test("parseUsageDateRange rejects invalid dates", () => {
    const result = parseUsageDateRange({
      from: "2026-13-01",
      to: "2026-01-01",
    });
    expect(result.ok).toBe(false);
  });

  test("parseUsageDateRange rejects inverted ranges", () => {
    const result = parseUsageDateRange({
      from: "2026-02-01",
      to: "2026-01-31",
    });
    expect(result.ok).toBe(false);
  });

  test("parseUsageDateRange returns null range when unset", () => {
    expect(parseUsageDateRange({ from: null, to: null })).toEqual({
      ok: true,
      range: null,
    });
  });

  test("getDateRangeDaysInclusive returns inclusive day count", () => {
    expect(
      getDateRangeDaysInclusive({ from: "2026-01-01", to: "2026-01-01" }),
    ).toBe(1);
    expect(
      getDateRangeDaysInclusive({ from: "2026-01-01", to: "2026-01-31" }),
    ).toBe(31);
  });
});
