import { describe, expect, test } from "bun:test";
import {
  buildUntrackedDiffFile,
  isGeneratedFile,
  parseNameStatus,
  parseStats,
  resolveBaseRef,
  splitDiffByFile,
  unescapeGitPath,
} from "./diff-utils";

function createExecSandbox(
  responses: Array<{ success: boolean; stdout: string }>,
): {
  sandbox: Parameters<typeof resolveBaseRef>[0];
  commands: string[];
} {
  const commands: string[] = [];

  return {
    commands,
    sandbox: {
      exec: async (command: string) => {
        commands.push(command);
        const nextResponse = responses.shift();
        if (!nextResponse) {
          throw new Error(`No mock response for command: ${command}`);
        }
        return {
          success: nextResponse.success,
          stdout: nextResponse.stdout,
          stderr: "",
          exitCode: nextResponse.success ? 0 : 1,
          truncated: false,
        };
      },
    } as Parameters<typeof resolveBaseRef>[0],
  };
}

describe("diff utils", () => {
  test("unescapeGitPath handles quoted and unquoted escaped paths", () => {
    expect(unescapeGitPath('"src\\/new\\ file.ts"')).toBe("src/new file.ts");
    expect(unescapeGitPath("docs\\/guide\\ v2.md")).toBe("docs/guide v2.md");
  });

  test("parseNameStatus parses modified, added, deleted, and renamed entries", () => {
    const output = [
      "M\tREADME.md",
      'A\t"src\\/new\\ file.ts"',
      "D\told.ts",
      'R100\t"old\\/name.ts"\t"new\\/name.ts"',
    ].join("\n");

    const parsed = parseNameStatus(output);

    expect(parsed.get("README.md")).toEqual({ status: "modified" });
    expect(parsed.get("src/new file.ts")).toEqual({ status: "added" });
    expect(parsed.get("old.ts")).toEqual({ status: "deleted" });
    expect(parsed.get("new/name.ts")).toEqual({
      status: "renamed",
      oldPath: "old/name.ts",
    });
  });

  test("parseStats parses additions/deletions for regular and quoted paths", () => {
    const output = ["12\t3\tsrc/app.ts", '1\t0\t"docs\\/new\\ file.md"'].join(
      "\n",
    );

    const parsed = parseStats(output);

    expect(parsed.get("src/app.ts")).toEqual({ additions: 12, deletions: 3 });
    expect(parsed.get("docs/new file.md")).toEqual({
      additions: 1,
      deletions: 0,
    });
  });

  test("splitDiffByFile splits mixed quoted and unquoted git diff blocks", () => {
    const fullDiff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 111..222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1 @@",
      "-a",
      "+b",
      'diff --git "a/docs/old name.md" "b/docs/new name.md"',
      "index 333..444 100644",
      '--- "a/docs/old name.md"',
      '+++ "b/docs/new name.md"',
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");

    const split = splitDiffByFile(fullDiff);

    expect(split.size).toBe(2);
    expect(split.get("src/a.ts")).toContain("diff --git a/src/a.ts b/src/a.ts");
    expect(split.get("docs/new name.md")).toContain('+++ "b/docs/new name.md"');
  });

  test("buildUntrackedDiffFile returns null for unreadable content", () => {
    expect(buildUntrackedDiffFile("file.ts", null)).toBeNull();
  });

  test("buildUntrackedDiffFile builds synthetic unified diff for new file", () => {
    const result = buildUntrackedDiffFile("src/new.ts", "line1\nline2\n");

    expect(result).not.toBeNull();
    if (!result) {
      return;
    }

    expect(result.lineCount).toBe(2);
    expect(result.file.status).toBe("added");
    expect(result.file.additions).toBe(2);
    expect(result.file.diff).toContain("@@ -0,0 +1,2 @@");
    expect(result.file.diff).toContain("+line1");
    expect(result.file.diff).toContain("+line2");
  });

  test("isGeneratedFile detects lock files", () => {
    expect(isGeneratedFile("pnpm-lock.yaml")).toBe(true);
    expect(isGeneratedFile("src/index.ts")).toBe(false);
  });

  test("resolveBaseRef prefers remote default branch when available", async () => {
    const { sandbox, commands } = createExecSandbox([
      { success: true, stdout: "refs/remotes/origin/main\n" },
    ]);

    const result = await resolveBaseRef(sandbox, "/repo");

    expect(result).toBe("origin/main");
    expect(commands).toEqual(["git symbolic-ref refs/remotes/origin/HEAD"]);
  });

  test("resolveBaseRef falls back to HEAD when no remote ref exists", async () => {
    const { sandbox, commands } = createExecSandbox([
      { success: false, stdout: "" },
      { success: true, stdout: "abc1234\n" },
    ]);

    const result = await resolveBaseRef(sandbox, "/repo");

    expect(result).toBe("HEAD");
    expect(commands).toEqual([
      "git symbolic-ref refs/remotes/origin/HEAD",
      "git rev-parse HEAD",
    ]);
  });

  test("resolveBaseRef returns null when repository has no commits", async () => {
    const { sandbox } = createExecSandbox([
      { success: false, stdout: "" },
      { success: false, stdout: "" },
    ]);

    const result = await resolveBaseRef(sandbox, "/repo");

    expect(result).toBeNull();
  });
});
