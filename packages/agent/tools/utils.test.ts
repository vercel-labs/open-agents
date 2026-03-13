import { describe, expect, test } from "bun:test";
import {
  getApprovalContext,
  isPathWithinDirectory,
  shellEscape,
  shouldAutoApprove,
  toDisplayPath,
} from "./utils";

describe("tools/utils", () => {
  test("isPathWithinDirectory handles nested and sibling paths", () => {
    expect(isPathWithinDirectory("/repo/src/index.ts", "/repo")).toBe(true);
    expect(isPathWithinDirectory("/repo", "/repo")).toBe(true);
    expect(isPathWithinDirectory("/repo-other/src/index.ts", "/repo")).toBe(
      false,
    );
  });

  test("toDisplayPath returns workspace-relative paths when possible", () => {
    expect(toDisplayPath("/repo/src/index.ts", "/repo")).toBe("src/index.ts");
    expect(toDisplayPath("src/index.ts", "/repo")).toBe("src/index.ts");
    expect(toDisplayPath("/repo", "/repo")).toBe(".");
    expect(toDisplayPath("/outside/file.ts", "/repo")).toBe("/outside/file.ts");
  });

  test("shouldAutoApprove only for background mode", () => {
    expect(shouldAutoApprove({ mode: "background" })).toBe(true);
    expect(shouldAutoApprove({ mode: "interactive" })).toBe(false);
    expect(shouldAutoApprove({})).toBe(false);
    expect(shouldAutoApprove(undefined)).toBe(false);
  });

  test("getApprovalContext defaults to empty approval when missing", () => {
    const context = getApprovalContext({
      sandbox: { workingDirectory: "/repo" },
      approval: undefined,
      model: "test-model",
    });

    expect(context.workingDirectory).toBe("/repo");
    expect(context.approval).toEqual({});
  });

  test("shellEscape safely escapes single quotes", () => {
    expect(shellEscape("simple")).toBe("'simple'");
    expect(shellEscape("it's fine")).toBe("'it'\\''s fine'");
  });
});
