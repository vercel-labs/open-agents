import { describe, expect, test } from "bun:test";
import {
  getSandboxContext,
  isPathWithinDirectory,
  shellEscape,
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

  test("getSandboxContext returns sandbox and working directory", () => {
    const context = getSandboxContext({
      sandbox: { workingDirectory: "/repo" },
      model: "test-model",
    });

    expect(context.workingDirectory).toBe("/repo");
    expect(context.sandbox.workingDirectory).toBe("/repo");
  });

  test("shellEscape safely escapes single quotes", () => {
    expect(shellEscape("simple")).toBe("'simple'");
    expect(shellEscape("it's fine")).toBe("'it'\\''s fine'");
  });
});
