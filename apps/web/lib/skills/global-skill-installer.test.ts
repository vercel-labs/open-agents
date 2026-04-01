import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

interface ExecCall {
  command: string;
  cwd: string;
  timeoutMs: number;
}

const execCalls: ExecCall[] = [];
const writeFileCalls: Array<{ path: string; content: string }> = [];
let manifestContent: string | null = null;

const sandbox = {
  workingDirectory: "/workspace",
  exec: mock(async (command: string, cwd: string, timeoutMs: number) => {
    execCalls.push({ command, cwd, timeoutMs });

    if (command === 'printf %s "$HOME"') {
      return {
        success: true,
        exitCode: 0,
        stdout: "/root",
        stderr: "",
        truncated: false,
      };
    }

    return {
      success: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      truncated: false,
    };
  }),
  readFile: mock(async () => {
    if (manifestContent === null) {
      throw new Error("missing");
    }

    return manifestContent;
  }),
  writeFile: mock(async (path: string, content: string) => {
    writeFileCalls.push({ path, content });
  }),
};

const installerModulePromise = import("./global-skill-installer");

describe("installGlobalSkills", () => {
  beforeEach(() => {
    execCalls.length = 0;
    writeFileCalls.length = 0;
    manifestContent = null;
    sandbox.exec.mockClear();
    sandbox.readFile.mockClear();
    sandbox.writeFile.mockClear();
  });

  test("installs refs and writes a manifest when not already installed", async () => {
    const { installGlobalSkills } = await installerModulePromise;

    await installGlobalSkills({
      sandbox: sandbox as never,
      sessionId: "session-1",
      globalSkillRefs: [{ source: "vercel/ai", skillName: "ai-sdk" }],
    });

    expect(execCalls).toEqual([
      {
        command: 'printf %s "$HOME"',
        cwd: "/workspace",
        timeoutMs: 5_000,
      },
      {
        command: "mkdir -p '/root/.open-harness/global-skills'",
        cwd: "/workspace",
        timeoutMs: 5_000,
      },
      {
        command:
          "HOME='/root' npx skills add 'vercel/ai' --skill 'ai-sdk' --agent amp -g -y --copy",
        cwd: "/workspace",
        timeoutMs: 120_000,
      },
    ]);
    expect(writeFileCalls).toEqual([
      {
        path: "/root/.open-harness/global-skills/session-1.json",
        content:
          '{\n  "version": 1,\n  "globalSkillRefs": [\n    {\n      "source": "vercel/ai",\n      "skillName": "ai-sdk"\n    }\n  ]\n}\n',
      },
    ]);
  });

  test("skips reinstall when the manifest already matches", async () => {
    const { installGlobalSkills } = await installerModulePromise;
    manifestContent = JSON.stringify({
      version: 1,
      globalSkillRefs: [{ source: "vercel/ai", skillName: "ai-sdk" }],
    });

    await installGlobalSkills({
      sandbox: sandbox as never,
      sessionId: "session-1",
      globalSkillRefs: [{ source: "vercel/ai", skillName: "ai-sdk" }],
    });

    expect(execCalls).toEqual([
      {
        command: 'printf %s "$HOME"',
        cwd: "/workspace",
        timeoutMs: 5_000,
      },
    ]);
    expect(writeFileCalls).toEqual([]);
  });
});
