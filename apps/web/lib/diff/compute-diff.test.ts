import { beforeEach, describe, expect, mock, test } from "bun:test";

// ── Spy state ──────────────────────────────────────────────────────

type ExecResult = {
  success: boolean;
  stdout: string;
  stderr?: string;
};

type ExecHandler = (
  command: string,
  cwd: string,
  timeout: number,
) => Promise<ExecResult>;

let execHandler: ExecHandler;
let readFileHandler: (path: string, encoding: string) => Promise<string>;

const updateSessionSpy = mock((_id: string, _patch: Record<string, unknown>) =>
  Promise.resolve(),
);

// ── Module mocks ───────────────────────────────────────────────────

mock.module("@/lib/db/sessions", () => ({
  updateSession: updateSessionSpy,
}));

mock.module("@/lib/sandbox/utils", () => ({
  isSandboxUnavailableError: (msg: string) =>
    msg.includes("sandbox unavailable"),
}));

const { computeAndCacheDiff, DiffComputationError } =
  await import("./compute-diff");

// ── Helpers ────────────────────────────────────────────────────────

function createSandbox(overrides?: {
  exec?: ExecHandler;
  readFile?: typeof readFileHandler;
}) {
  return {
    workingDirectory: "/vercel/sandbox",
    exec:
      overrides?.exec ??
      execHandler ??
      (async () => ({ success: true, stdout: "", stderr: "" })),
    readFile: overrides?.readFile ?? readFileHandler,
  };
}

function makeExecHandler(
  responses: Record<string, ExecResult | ((cmd: string) => ExecResult)>,
): ExecHandler {
  return async (command: string) => {
    for (const [key, value] of Object.entries(responses)) {
      if (command.includes(key)) {
        return typeof value === "function" ? value(command) : value;
      }
    }
    return { success: true, stdout: "", stderr: "" };
  };
}

// ── Tests ──────────────────────────────────────────────────────────

beforeEach(() => {
  updateSessionSpy.mockClear();
  readFileHandler = async () => "file content\n";
});

describe("computeAndCacheDiff", () => {
  describe("no-commits path (baseRef === null)", () => {
    test("lists untracked files as added", async () => {
      execHandler = makeExecHandler({
        "git symbolic-ref refs/remotes/origin/HEAD": {
          success: false,
          stdout: "",
        },
        "git rev-parse HEAD": { success: false, stdout: "" },
        "git ls-files --others": {
          success: true,
          stdout: "file1.ts\nfile2.ts\n",
        },
      });

      const result = await computeAndCacheDiff({
        sandbox: createSandbox() as never,
        sessionId: "session-1",
      });

      expect(result.files).toHaveLength(2);
      expect(result.files[0].status).toBe("added");
      expect(result.files[1].status).toBe("added");
      expect(result.baseRef).toBe("(no commits)");
    });

    test("throws DiffComputationError when ls-files fails in no-commit repo", async () => {
      execHandler = makeExecHandler({
        "git symbolic-ref refs/remotes/origin/HEAD": {
          success: false,
          stdout: "",
        },
        "git rev-parse HEAD": { success: false, stdout: "" },
        "git ls-files --others": {
          success: false,
          stdout: "",
          stderr: "fatal: not a git repo",
        },
      });

      try {
        await computeAndCacheDiff({
          sandbox: createSandbox() as never,
          sessionId: "session-1",
        });
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect(error).toBeInstanceOf(DiffComputationError);
        expect(
          (error as InstanceType<typeof DiffComputationError>).status,
        ).toBe(400);
      }
    });

    test("re-throws sandbox unavailable errors in no-commit path", async () => {
      execHandler = makeExecHandler({
        "git symbolic-ref refs/remotes/origin/HEAD": {
          success: false,
          stdout: "",
        },
        "git rev-parse HEAD": { success: false, stdout: "" },
        "git ls-files --others": {
          success: false,
          stdout: "",
          stderr: "sandbox unavailable",
        },
      });

      try {
        await computeAndCacheDiff({
          sandbox: createSandbox() as never,
          sessionId: "session-1",
        });
        expect(true).toBe(false);
      } catch (error) {
        expect(error).not.toBeInstanceOf(DiffComputationError);
        expect((error as Error).message).toBe("sandbox unavailable");
      }
    });

    test("skips unreadable files in no-commit path", async () => {
      execHandler = makeExecHandler({
        "git symbolic-ref refs/remotes/origin/HEAD": {
          success: false,
          stdout: "",
        },
        "git rev-parse HEAD": { success: false, stdout: "" },
        "git ls-files --others": {
          success: true,
          stdout: "good.ts\nbinary.png\n",
        },
      });

      const result = await computeAndCacheDiff({
        sandbox: createSandbox({
          readFile: async (path: string) => {
            if (path.includes("binary.png")) throw new Error("Binary file");
            return "content\n";
          },
        }) as never,
        sessionId: "session-1",
      });

      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe("good.ts");
    });
  });

  describe("normal path (with commits)", () => {
    test("returns diff files with correct structure", async () => {
      const result = await computeAndCacheDiff({
        sandbox: createSandbox({
          exec: async (command: string) => {
            if (command === "git symbolic-ref refs/remotes/origin/HEAD")
              return {
                success: true,
                stdout: "refs/remotes/origin/main",
                stderr: "",
              };
            if (command.includes("merge-base"))
              return { success: true, stdout: "aaa111\n", stderr: "" };
            if (command.includes("--name-status"))
              return {
                success: true,
                stdout: "M\tsrc/index.ts\nA\tsrc/new.ts\n",
                stderr: "",
              };
            if (command.includes("--numstat"))
              return {
                success: true,
                stdout: "10\t2\tsrc/index.ts\n15\t0\tsrc/new.ts\n",
                stderr: "",
              };
            if (command.includes("git diff aaa111"))
              return {
                success: true,
                stdout: [
                  "diff --git a/src/index.ts b/src/index.ts",
                  "--- a/src/index.ts",
                  "+++ b/src/index.ts",
                  "@@ -1,3 +1,5 @@",
                  " line1",
                  "+added",
                  "",
                  "diff --git a/src/new.ts b/src/new.ts",
                  "--- /dev/null",
                  "+++ b/src/new.ts",
                  "@@ -0,0 +1,15 @@",
                  "+new file",
                ].join("\n"),
                stderr: "",
              };
            if (command.includes("ls-files"))
              return { success: true, stdout: "", stderr: "" };
            if (command.includes("--cached --name-only"))
              return {
                success: true,
                stdout: "src/index.ts\n",
                stderr: "",
              };
            if (command === "git diff --name-only")
              return {
                success: true,
                stdout: "src/new.ts\n",
                stderr: "",
              };
            return { success: true, stdout: "", stderr: "" };
          },
        }) as never,
        sessionId: "session-1",
      });

      expect(result.files.length).toBeGreaterThanOrEqual(2);
      expect(result.summary.totalAdditions).toBe(25);
      expect(result.summary.totalDeletions).toBe(2);

      // Check staging status
      const indexFile = result.files.find((f) => f.path === "src/index.ts");
      expect(indexFile?.stagingStatus).toBe("staged"); // only in staged set

      const newFile = result.files.find((f) => f.path === "src/new.ts");
      expect(newFile?.stagingStatus).toBe("unstaged"); // only in unstaged set
    });

    test("throws DiffComputationError when diff command fails", async () => {
      try {
        await computeAndCacheDiff({
          sandbox: createSandbox({
            exec: async (command: string) => {
              if (command === "git symbolic-ref refs/remotes/origin/HEAD")
                return {
                  success: true,
                  stdout: "refs/remotes/origin/main",
                  stderr: "",
                };
              if (command.includes("merge-base"))
                return { success: true, stdout: "aaa111\n", stderr: "" };
              if (command.includes("--name-status"))
                return {
                  success: false,
                  stdout: "",
                  stderr: "fatal: bad ref",
                };
              if (command.includes("--numstat"))
                return { success: true, stdout: "", stderr: "" };
              if (command.includes("git diff aaa111"))
                return {
                  success: false,
                  stdout: "",
                  stderr: "fatal: bad ref",
                };
              if (command.includes("ls-files"))
                return { success: true, stdout: "", stderr: "" };
              if (command.includes("--cached"))
                return { success: true, stdout: "", stderr: "" };
              return { success: true, stdout: "", stderr: "" };
            },
          }) as never,
          sessionId: "session-1",
        });
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(DiffComputationError);
      }
    });

    test("caches diff to session via fire-and-forget", async () => {
      await computeAndCacheDiff({
        sandbox: createSandbox({
          exec: async (command: string) => {
            if (command === "git symbolic-ref refs/remotes/origin/HEAD")
              return {
                success: true,
                stdout: "refs/remotes/origin/main",
                stderr: "",
              };
            if (command.includes("merge-base"))
              return { success: true, stdout: "aaa111\n", stderr: "" };
            return { success: true, stdout: "", stderr: "" };
          },
        }) as never,
        sessionId: "session-1",
      });

      // Give the fire-and-forget a tick to resolve
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(updateSessionSpy).toHaveBeenCalledTimes(1);
      const [sessionId, patch] = updateSessionSpy.mock.calls[0];
      expect(sessionId).toBe("session-1");
      expect(patch).toHaveProperty("cachedDiff");
      expect(patch).toHaveProperty("cachedDiffUpdatedAt");
    });

    test("excludes generated files from full diff command", async () => {
      const executedCommands: string[] = [];

      const result = await computeAndCacheDiff({
        sandbox: createSandbox({
          exec: async (command: string) => {
            executedCommands.push(command);

            if (command.includes("git symbolic-ref refs/heads"))
              return { success: true, stdout: "refs/heads/main", stderr: "" };
            if (command.includes("rev-parse --verify --quiet HEAD"))
              return { success: true, stdout: "abc123", stderr: "" };
            if (
              command.includes(
                "rev-parse --verify --quiet refs/remotes/origin/HEAD",
              )
            )
              return { success: true, stdout: "def456", stderr: "" };
            if (command.includes("symbolic-ref refs/remotes/origin/HEAD"))
              return {
                success: true,
                stdout: "refs/remotes/origin/main",
                stderr: "",
              };
            if (command.includes("merge-base"))
              return { success: true, stdout: "aaa111\n", stderr: "" };
            if (command.includes("--name-status"))
              return {
                success: true,
                stdout: "M\tsrc/index.ts\nM\tpackage-lock.json\nM\tbun.lock\n",
                stderr: "",
              };
            if (command.includes("--numstat"))
              return {
                success: true,
                stdout:
                  "5\t2\tsrc/index.ts\n100\t50\tpackage-lock.json\n200\t100\tbun.lock\n",
                stderr: "",
              };
            if (command.includes("git diff aaa111"))
              return {
                success: true,
                stdout:
                  "diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@\n-old\n+new\n",
                stderr: "",
              };
            if (command.includes("ls-files"))
              return { success: true, stdout: "", stderr: "" };
            if (command.includes("--cached --name-only"))
              return { success: true, stdout: "", stderr: "" };
            if (command === "git diff --name-only")
              return { success: true, stdout: "", stderr: "" };
            return { success: true, stdout: "", stderr: "" };
          },
        }) as never,
        sessionId: "session-1",
      });

      // The diff command should exclude generated files
      const diffCmd = executedCommands.find(
        (c) => c.includes("git diff aaa111 --") || c.includes(":(exclude)"),
      );
      expect(diffCmd).toBeDefined();

      // Generated files should still appear in the file list but with empty diff
      const lockFile = result.files.find((f) => f.path === "package-lock.json");
      expect(lockFile).toBeDefined();
      expect(lockFile!.generated).toBe(true);
      expect(lockFile!.diff).toBe("");
    });

    test("adds untracked files to the result", async () => {
      readFileHandler = async () => "const x = 1;\n";

      const result = await computeAndCacheDiff({
        sandbox: createSandbox({
          exec: async (command: string) => {
            if (command === "git symbolic-ref refs/remotes/origin/HEAD")
              return {
                success: true,
                stdout: "refs/remotes/origin/main",
                stderr: "",
              };
            if (command.includes("merge-base"))
              return { success: true, stdout: "aaa111\n", stderr: "" };
            if (command.includes("ls-files --others"))
              return {
                success: true,
                stdout: "new-file.ts\n",
                stderr: "",
              };
            return { success: true, stdout: "", stderr: "" };
          },
          readFile: readFileHandler,
        }) as never,
        sessionId: "session-1",
      });

      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe("new-file.ts");
      expect(result.files[0].status).toBe("added");
    });
  });

  describe("DiffComputationError", () => {
    test("has correct name and status", () => {
      const error = new DiffComputationError("test error", 400);
      expect(error.name).toBe("DiffComputationError");
      expect(error.status).toBe(400);
      expect(error.message).toBe("test error");
    });
  });
});
