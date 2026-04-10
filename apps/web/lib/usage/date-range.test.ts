import { describe, expect, test } from "bun:test";
import {
  formatDateOnly,
  formatDateOnlyLabel,
  formatUsageDateRangeLabel,
  getDateRangeDaysInclusive,
  parsePublicUsageDate,
  parseUsageDateRange,
} from "./date-range";

describe("usage date range helpers", () => {
  test("formatDateOnly returns YYYY-MM-DD", () => {
    expect(formatDateOnly(new Date("2026-02-03T15:00:00.000Z"))).toBe(
      "2026-02-03",
    );
  });

  test("formatDateOnlyLabel returns a readable UTC label", () => {
    expect(formatDateOnlyLabel("2026-02-03")).toBe("Feb 3, 2026");
  });

  test("formatUsageDateRangeLabel formats single-day and multi-day ranges", () => {
    expect(
      formatUsageDateRangeLabel({ from: "2026-02-03", to: "2026-02-03" }),
    ).toBe("Feb 3, 2026");
    expect(
      formatUsageDateRangeLabel({ from: "2026-02-03", to: "2026-02-14" }),
    ).toBe("Feb 3, 2026 – Feb 14, 2026");
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

  test("parsePublicUsageDate accepts preset windows", () => {
    expect(
      parsePublicUsageDate("30d", new Date("2026-02-14T12:00:00.000Z")),
    ).toEqual({
      ok: true,
      selection: {
        kind: "preset",
        value: "30d",
        label: "Last 30 days",
        range: { from: "2026-01-16", to: "2026-02-14" },
      },
    });
  });

  test("parsePublicUsageDate accepts explicit ranges", () => {
    expect(parsePublicUsageDate("2026-01-01..2026-01-31")).toEqual({
      ok: true,
      selection: {
        kind: "range",
        value: "2026-01-01..2026-01-31",
        label: "Jan 1, 2026 – Jan 31, 2026",
        range: { from: "2026-01-01", to: "2026-01-31" },
      },
    });
  });

  test("parsePublicUsageDate returns all-time when unset", () => {
    expect(parsePublicUsageDate(null)).toEqual({
      ok: true,
      selection: {
        kind: "all",
        value: null,
        label: "All time",
        range: null,
      },
    });
  });

  test("parsePublicUsageDate rejects invalid values", () => {
    const result = parsePublicUsageDate("last-month");
    expect(result.ok).toBe(false);
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
