import { describe, expect, test } from "bun:test";
import type { Sandbox } from "@open-agents/sandbox";
import { createDownloadDiff, DownloadDiffError } from "./download-diff";

type ExecResult = {
  success: boolean;
  stdout: string;
  stderr?: string;
};

function createSandbox(params: {
  exec: (command: string) => Promise<ExecResult>;
  readFile?: (path: string, encoding: "utf-8") => Promise<string>;
}): Sandbox {
  return {
    type: "cloud",
    workingDirectory: "/repo",
    exec: async (command: string, _cwd: string, _timeout: number) => {
      const result = await params.exec(command);
      return {
        success: result.success,
        exitCode: result.success ? 0 : 1,
        stdout: result.stdout,
        stderr: result.stderr ?? "",
        truncated: false,
      };
    },
    readFile:
      params.readFile ??
      (async () => {
        throw new Error("not found");
      }),
    readFileBuffer: async () => Buffer.from(""),
    writeFile: async () => {},
    stat: async () => ({
      isDirectory: () => false,
      isFile: () => true,
      size: 0,
      mtimeMs: 0,
    }),
    access: async () => {},
    mkdir: async () => {},
    readdir: async () => [],
    stop: async () => {},
  };
}

describe("createDownloadDiff", () => {
  test("returns the full tracked diff from the merge base", async () => {
    const commands: string[] = [];

    const result = await createDownloadDiff(
      createSandbox({
        exec: async (command) => {
          commands.push(command);

          if (command === "git symbolic-ref refs/remotes/origin/HEAD") {
            return { success: true, stdout: "refs/remotes/origin/main\n" };
          }
          if (command === "git merge-base origin/main HEAD") {
            return { success: true, stdout: "abc123\n" };
          }
          if (command === "git diff abc123") {
            return {
              success: true,
              stdout:
                "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n",
            };
          }
          if (command === "git ls-files --others --exclude-standard") {
            return { success: true, stdout: "" };
          }
          if (command === "git branch --show-current") {
            return { success: true, stdout: "feature/download-diff\n" };
          }

          return { success: true, stdout: "" };
        },
      }),
    );

    expect(result.filename).toBe("feature-download-diff.diff");
    expect(result.content).toContain("diff --git a/src/a.ts b/src/a.ts");
    expect(commands).toContain("git diff abc123");
  });

  test("includes readable untracked files", async () => {
    const result = await createDownloadDiff(
      createSandbox({
        exec: async (command) => {
          if (command === "git symbolic-ref refs/remotes/origin/HEAD") {
            return { success: false, stdout: "" };
          }
          if (command === "git rev-parse HEAD") {
            return { success: true, stdout: "head123\n" };
          }
          if (command === "git diff HEAD") {
            return { success: true, stdout: "" };
          }
          if (command === "git ls-files --others --exclude-standard") {
            return { success: true, stdout: "src/new.ts\n" };
          }
          if (command === "git branch --show-current") {
            return { success: true, stdout: "main\n" };
          }

          return { success: true, stdout: "" };
        },
        readFile: async () => "export const value = 1;\n",
      }),
    );

    expect(result.content).toContain("diff --git a/src/new.ts b/src/new.ts");
    expect(result.content).toContain("+export const value = 1;");
  });

  test("includes empty untracked files as valid git patches", async () => {
    const result = await createDownloadDiff(
      createSandbox({
        exec: async (command) => {
          if (command === "git symbolic-ref refs/remotes/origin/HEAD") {
            return { success: false, stdout: "" };
          }
          if (command === "git rev-parse HEAD") {
            return { success: true, stdout: "head123\n" };
          }
          if (command === "git diff HEAD") {
            return { success: true, stdout: "" };
          }
          if (command === "git ls-files --others --exclude-standard") {
            return { success: true, stdout: "src/empty.ts\n" };
          }
          if (command === "git branch --show-current") {
            return { success: true, stdout: "main\n" };
          }

          return { success: true, stdout: "" };
        },
        readFile: async () => "",
      }),
    );

    expect(result.content).toContain(
      "diff --git a/src/empty.ts b/src/empty.ts",
    );
    expect(result.content).toContain("index 0000000..e69de29");
    expect(result.content).not.toContain("@@ -0,0 +1,0 @@");
  });

  test("throws when there are no downloadable changes", async () => {
    await expect(
      createDownloadDiff(
        createSandbox({
          exec: async (command) => {
            if (command === "git symbolic-ref refs/remotes/origin/HEAD") {
              return { success: false, stdout: "" };
            }
            if (command === "git rev-parse HEAD") {
              return { success: true, stdout: "head123\n" };
            }
            if (command === "git diff HEAD") {
              return { success: true, stdout: "" };
            }
            if (command === "git ls-files --others --exclude-standard") {
              return { success: true, stdout: "" };
            }
            return { success: true, stdout: "" };
          },
        }),
      ),
    ).rejects.toBeInstanceOf(DownloadDiffError);
  });
});
