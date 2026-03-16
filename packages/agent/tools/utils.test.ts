import { beforeEach, describe, expect, mock, test } from "bun:test";

const connectSandboxCalls: unknown[][] = [];
const tryConnectDirectCalls: unknown[][] = [];

let connectSandboxResult: unknown = {
  workingDirectory: "/repo",
};
let tryConnectDirectResult: unknown = null;

mock.module("@open-harness/sandbox", () => ({
  connectSandbox: async (...args: unknown[]) => {
    connectSandboxCalls.push(args);
    return connectSandboxResult;
  },
  tryConnectVercelSandboxDirect: async (...args: unknown[]) => {
    tryConnectDirectCalls.push(args);
    return tryConnectDirectResult;
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
  tryConnectDirectCalls.length = 0;
  connectSandboxResult = {
    workingDirectory: "/repo",
  };
  tryConnectDirectResult = null;
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

  test("getSandbox prefers direct connector for vercel sandbox IDs", async () => {
    tryConnectDirectResult = {
      workingDirectory: "/repo",
      exec: async () => ({
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        truncated: false,
      }),
    };

    const sandbox = await getSandbox(
      {
        sandbox: {
          state: { type: "vercel", sandboxId: "sbx-123" },
          workingDirectory: "/repo",
        },
        model: "test-model",
      },
      "read",
    );

    expect(sandbox.workingDirectory).toBe("/repo");
    expect(tryConnectDirectCalls).toEqual([
      [{ sandboxId: "sbx-123", workingDirectory: "/repo" }],
    ]);
    expect(connectSandboxCalls.length).toBe(0);
  });

  test("getSandbox falls back to connectSandbox when direct connector is unavailable", async () => {
    tryConnectDirectResult = null;

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
    expect(tryConnectDirectCalls).toEqual([
      [{ sandboxId: "sbx-456", workingDirectory: "/repo" }],
    ]);
    expect(connectSandboxCalls).toEqual([
      [{ type: "vercel", sandboxId: "sbx-456" }],
    ]);
  });

  test("shellEscape safely escapes single quotes", () => {
    expect(shellEscape("simple")).toBe("'simple'");
    expect(shellEscape("it's fine")).toBe("'it'\\''s fine'");
  });
});
