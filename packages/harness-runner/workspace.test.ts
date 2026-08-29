import { describe, expect, mock, test } from "bun:test";
import { linkHarnessWorkingDirectory } from "./workspace";

type LinkOptions = Parameters<typeof linkHarnessWorkingDirectory>[0];

describe("linkHarnessWorkingDirectory", () => {
  test("links the external harness directory to the Open Agents workspace", async () => {
    const run = mock(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
    }));
    const session = { run } as unknown as LinkOptions["session"];

    await linkHarnessWorkingDirectory({
      session,
      sessionWorkDir: "/tmp/open-agents-harness/codex-session-1",
      workingDirectory: "/vercel/sandbox",
    });

    expect(run).toHaveBeenCalledWith({
      command:
        "rm -rf -- '/tmp/open-agents-harness/codex-session-1' && ln -s -- '/vercel/sandbox' '/tmp/open-agents-harness/codex-session-1'",
      abortSignal: undefined,
    });
  });

  test("surfaces sandbox link failures", async () => {
    const session = {
      run: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "permission denied",
      }),
    } as unknown as LinkOptions["session"];

    await expect(
      linkHarnessWorkingDirectory({
        session,
        sessionWorkDir: "/tmp/open-agents-harness/codex-session-1",
        workingDirectory: "/vercel/sandbox",
      }),
    ).rejects.toThrow("Failed to link harness workspace: permission denied");
  });
});
