import { beforeEach, describe, expect, mock, test } from "bun:test";

const connectSandboxCalls: unknown[][] = [];

let connectSandboxResult: unknown = {
  workingDirectory: "/repo",
};

mock.module("@open-harness/sandbox", () => ({
  connectSandbox: async (...args: unknown[]) => {
    connectSandboxCalls.push(args);
    return connectSandboxResult;
  },
}));

const {
  getSandbox,
  getSandboxContext,
  isPathWithinDirectory,
  shellEscape,
  toDisplayPath,
} = await import("./utils");

beforeEach(() => {
  connectSandboxCalls.length = 0;
  connectSandboxResult = {
    workingDirectory: "/repo",
  };
});

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

  test("getSandboxContext returns serializable sandbox context and working directory", () => {
    const context = getSandboxContext({
      sandbox: {
        state: { type: "vercel" },
        workingDirectory: "/repo",
      },
      model: "test-model",
    });

    expect(context.workingDirectory).toBe("/repo");
    expect(context.sandbox.workingDirectory).toBe("/repo");
  });

  test("getSandbox connects using the sandbox state from context", async () => {
    const sandbox = await getSandbox(
      {
        sandbox: {
          state: { type: "vercel", sandboxId: "sbx-456" },
          workingDirectory: "/repo",
        },
        model: "test-model",
      },
      "read",
    );

    expect(sandbox.workingDirectory).toBe("/repo");
    expect(connectSandboxCalls).toEqual([
      [{ type: "vercel", sandboxId: "sbx-456" }],
    ]);
  });

  test("shellEscape safely escapes single quotes", () => {
    expect(shellEscape("simple")).toBe("'simple'");
    expect(shellEscape("it's fine")).toBe("'it'\\''s fine'");
  });
});
