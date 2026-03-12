import { describe, expect, test } from "bun:test";
import {
  detectCompletedSessions,
  getStreamingIds,
  shouldSendBrowserNotification,
  wasPageRecentlyForegrounded,
} from "./use-background-chat-notifications";

const notify = () => undefined;

describe("getStreamingIds", () => {
  test("returns empty set when no items are streaming", () => {
    const items = [
      { id: "a", streaming: false },
      { id: "b", streaming: false },
    ];
    expect(getStreamingIds(items)).toEqual(new Set());
  });

  test("returns only streaming item IDs", () => {
    const items = [
      { id: "a", streaming: true },
      { id: "b", streaming: false },
      { id: "c", streaming: true },
    ];
    expect(getStreamingIds(items)).toEqual(new Set(["a", "c"]));
  });

  test("handles empty list", () => {
    expect(getStreamingIds([])).toEqual(new Set());
  });
});

describe("shouldSendBrowserNotification", () => {
  test("returns true when browser notifications are enabled and a handler exists", () => {
    expect(shouldSendBrowserNotification(true, notify)).toBe(true);
  });

  test("returns false when browser notifications are disabled", () => {
    expect(shouldSendBrowserNotification(false, notify)).toBe(false);
  });

  test("returns false when no browser notification handler is provided", () => {
    expect(shouldSendBrowserNotification(true)).toBe(false);
  });
});

describe("wasPageRecentlyForegrounded", () => {
  test("returns true immediately after the tab comes back to the foreground", () => {
    expect(wasPageRecentlyForegrounded(1_000, 4_000, 6_000)).toBe(true);
  });

  test("returns false when the page was never backgrounded", () => {
    expect(wasPageRecentlyForegrounded(0, 4_000, 6_000)).toBe(false);
  });

  test("returns false when the foreground event predates the last background event", () => {
    expect(wasPageRecentlyForegrounded(5_000, 4_000, 6_000)).toBe(false);
  });

  test("returns false once the recent foreground window expires", () => {
    expect(wasPageRecentlyForegrounded(1_000, 4_000, 10_000)).toBe(false);
  });
});

describe("detectCompletedSessions", () => {
  test("detects a session that stopped streaming", () => {
    const prev = new Set(["s1"]);
    const items = [
      { id: "s1", streaming: false },
      { id: "s2", streaming: false },
    ];
    const result = detectCompletedSessions(prev, items, "s2");
    expect(result).toEqual(["s1"]);
  });

  test("does not report the active session", () => {
    const prev = new Set(["s1"]);
    const items = [
      { id: "s1", streaming: false },
      { id: "s2", streaming: false },
    ];
    // s1 stopped streaming but is the active session — should be excluded
    const result = detectCompletedSessions(prev, items, "s1");
    expect(result).toEqual([]);
  });

  test("does not report sessions still streaming", () => {
    const prev = new Set(["s1", "s2"]);
    const items = [
      { id: "s1", streaming: true },
      { id: "s2", streaming: false },
    ];
    const result = detectCompletedSessions(prev, items, null);
    // s1 still streaming, only s2 completed
    expect(result).toEqual(["s2"]);
  });

  test("returns empty when nothing was previously streaming", () => {
    const prev = new Set<string>();
    const items = [
      { id: "s1", streaming: false },
      { id: "s2", streaming: false },
    ];
    const result = detectCompletedSessions(prev, items, null);
    expect(result).toEqual([]);
  });

  test("returns empty when all previously streaming sessions are still streaming", () => {
    const prev = new Set(["s1", "s2"]);
    const items = [
      { id: "s1", streaming: true },
      { id: "s2", streaming: true },
    ];
    const result = detectCompletedSessions(prev, items, null);
    expect(result).toEqual([]);
  });

  test("detects multiple sessions completing at once", () => {
    const prev = new Set(["s1", "s2", "s3"]);
    const items = [
      { id: "s1", streaming: false },
      { id: "s2", streaming: false },
      { id: "s3", streaming: true },
    ];
    const result = detectCompletedSessions(prev, items, null);
    expect(result).toEqual(["s1", "s2"]);
  });

  test("ignores sessions that were never streaming", () => {
    const prev = new Set(["s2"]);
    const items = [
      { id: "s1", streaming: false },
      { id: "s2", streaming: false },
    ];
    // s1 was never streaming, should not appear
    const result = detectCompletedSessions(prev, items, null);
    expect(result).toEqual(["s2"]);
  });

  test("handles active session being null", () => {
    const prev = new Set(["s1"]);
    const items = [{ id: "s1", streaming: false }];
    const result = detectCompletedSessions(prev, items, null);
    expect(result).toEqual(["s1"]);
  });

  test("excludes only the active session when multiple complete", () => {
    const prev = new Set(["s1", "s2", "s3"]);
    const items = [
      { id: "s1", streaming: false },
      { id: "s2", streaming: false },
      { id: "s3", streaming: false },
    ];
    const result = detectCompletedSessions(prev, items, "s2");
    expect(result).toEqual(["s1", "s3"]);
  });
});
