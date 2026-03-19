import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ToolNeedsApprovalFunction } from "./utils";

const sandboxRegistry = new Map<string, Record<string, unknown>>();

mock.module("ai", () => {
  class MockToolLoopAgent {
    constructor(_config: unknown) {}

    stream() {
      throw new Error(
        "MockToolLoopAgent.stream should not be called in this test",
      );
    }
  }

  const gateway = (modelId: string) => ({ modelId });

  return {
    tool: <T extends Record<string, unknown>>(definition: T) => definition,
    gateway,
    stepCountIs: (count: number) => ({ count }),
    ToolLoopAgent: MockToolLoopAgent,
    getToolName: (part: { toolName?: string; type?: string }) => {
      if (part.toolName) {
        return part.toolName;
      }

      if (typeof part.type === "string" && part.type.startsWith("tool-")) {
        return part.type.slice(5);
      }

      return "";
    },
    isToolUIPart: (part: unknown) => {
      if (!part || typeof part !== "object") {
        return false;
      }

      const candidate = part as { type?: unknown };
      return (
        typeof candidate.type === "string" && candidate.type.startsWith("tool-")
      );
    },
  };
});

mock.module("@open-harness/sandbox", () => ({
  connectSandbox: async (state: { sandboxId?: string }) => {
    if (!state.sandboxId) {
      throw new Error("Missing sandboxId in test sandbox state.");
    }

    const sandbox = sandboxRegistry.get(state.sandboxId);
    if (!sandbox) {
      throw new Error(`Unknown test sandbox: ${state.sandboxId}`);
    }

    return sandbox;
  },
  tryConnectVercelSandboxDirect: async () => null,
}));

const { askUserQuestionTool } = await import("./ask-user-question");
const { bashTool, commandNeedsApproval } = await import("./bash");
const { webFetchTool } = await import("./fetch");
const { globTool } = await import("./glob");
const { grepTool } = await import("./grep");
const { readFileTool } = await import("./read");
const { skillTool } = await import("./skill");
const { taskTool } = await import("./task");
const { todoWriteTool } = await import("./todo");
const { editFileTool, writeFileTool } = await import("./write");

function createContext(sandbox: Record<string, unknown>) {
  const sandboxId = `sandbox-${sandboxRegistry.size + 1}`;
  sandboxRegistry.set(sandboxId, sandbox);

  return {
    sandbox: {
      state: { type: "vercel" as const, sandboxId },
      workingDirectory:
        typeof sandbox.workingDirectory === "string"
          ? sandbox.workingDirectory
          : "/repo",
    },
    approval: {},
    model: "test-model",
  };
}

function executionOptions(experimental_context?: unknown) {
  return {
    toolCallId: "tool-call-1",
    messages: [],
    experimental_context,
  };
}

async function getNeedsApprovalResult<TArgs>(
  needsApproval: boolean | ToolNeedsApprovalFunction<TArgs> | undefined,
  args: TArgs,
  experimental_context: unknown,
) {
  if (typeof needsApproval === "function") {
    return await Promise.resolve(
      needsApproval(args, executionOptions(experimental_context)),
    );
  }
  return needsApproval ?? false;
}

async function createFsSandbox() {
  const workingDirectory = await mkdtemp(path.join(tmpdir(), "agent-tools-"));

  const sandbox = {
    workingDirectory,
    stat: (filePath: string) => stat(filePath),
    readFile: (filePath: string, encoding: BufferEncoding) =>
      readFile(filePath, { encoding }),
    writeFile: (filePath: string, content: string, encoding: BufferEncoding) =>
      writeFile(filePath, content, { encoding }),
    mkdir: (dirPath: string, options: { recursive: boolean }) =>
      mkdir(dirPath, options),
  };

  return { sandbox, workingDirectory };
}

describe("tools execute behavior", () => {
  test("readFileTool returns numbered lines for offset/limit", async () => {
    const { sandbox, workingDirectory } = await createFsSandbox();
    const filePath = path.join(workingDirectory, "notes.txt");
    await writeFile(filePath, "line-1\nline-2\nline-3", "utf-8");

    const result = await readFileTool().execute?.(
      { filePath, offset: 2, limit: 2 },
      executionOptions(createContext(sandbox)),
    );

    expect(result).toEqual({
      success: true,
      path: "notes.txt",
      totalLines: 3,
      startLine: 2,
      endLine: 3,
      content: "2: line-2\n3: line-3",
    });
  });

  test("readFileTool rejects reading directories", async () => {
    const { sandbox, workingDirectory } = await createFsSandbox();

    const result = await readFileTool().execute?.(
      { filePath: workingDirectory },
      executionOptions(createContext(sandbox)),
    );

    expect(result).toEqual({
      success: false,
      error: "Cannot read a directory. Use glob or ls command instead.",
    });
  });

  test("writeFileTool creates parent directories and writes content", async () => {
    const { sandbox, workingDirectory } = await createFsSandbox();
    const relativePath = "nested/output.txt";

    const result = await writeFileTool().execute?.(
      { filePath: relativePath, content: "hello" },
      executionOptions(createContext(sandbox)),
    );

    const expectedPath = path.join(workingDirectory, relativePath);
    const written = await readFile(expectedPath, "utf-8");

    expect(written).toBe("hello");
    expect(result).toEqual({
      success: true,
      path: relativePath,
      bytesWritten: 5,
    });
  });

  test("editFileTool rejects ambiguous replacement unless replaceAll is true", async () => {
    const { sandbox, workingDirectory } = await createFsSandbox();
    const filePath = path.join(workingDirectory, "src.txt");
    await writeFile(filePath, "alpha\nalpha\nomega", "utf-8");

    const result = await editFileTool().execute?.(
      { filePath, oldString: "alpha", newString: "beta" },
      executionOptions(createContext(sandbox)),
    );

    expect(result).toEqual({
      success: false,
      error:
        "oldString found 2 times. Use replaceAll=true or provide more context to make it unique.",
    });
  });

  test("editFileTool replaces all matches and reports first start line", async () => {
    const { sandbox, workingDirectory } = await createFsSandbox();
    const filePath = path.join(workingDirectory, "src.txt");
    await writeFile(filePath, "alpha\nalpha\nomega", "utf-8");

    const result = await editFileTool().execute?.(
      { filePath, oldString: "alpha", newString: "beta", replaceAll: true },
      executionOptions(createContext(sandbox)),
    );

    const content = await readFile(filePath, "utf-8");
    expect(content).toBe("beta\nbeta\nomega");
    expect(result).toEqual({
      success: true,
      path: "src.txt",
      replacements: 2,
      startLine: 1,
    });
  });

  test("grepTool parses grep output and truncates long content", async () => {
    let executedCommand = "";
    const sandbox = {
      workingDirectory: "/repo",
      exec: async (command: string) => {
        executedCommand = command;
        return {
          success: true,
          exitCode: 0,
          stdout:
            "/repo/src/a.ts:12:match-a\n/repo/src/b.ts:7:" + "x".repeat(300),
          stderr: "",
        };
      },
    };

    const result = await grepTool().execute?.(
      {
        pattern: "match",
        path: "src",
        glob: "*.ts",
        caseSensitive: false,
      },
      executionOptions(createContext(sandbox)),
    );

    expect(executedCommand).toContain("--include='*.ts'");
    expect(executedCommand).toContain(" -i ");
    expect(result).toMatchObject({
      success: true,
      pattern: "match",
      matchCount: 2,
      filesWithMatches: 2,
    });

    const firstMatch =
      result && typeof result === "object" && "matches" in result
        ? (result.matches as Array<{ file: string; content: string }>)[0]
        : undefined;
    const secondMatch =
      result && typeof result === "object" && "matches" in result
        ? (result.matches as Array<{ file: string; content: string }>)[1]
        : undefined;

    expect(firstMatch?.file).toBe("src/a.ts");
    expect(secondMatch?.content.length).toBe(200);
  });

  test("globTool parses find output into sorted file metadata", async () => {
    let executedCommand = "";
    const sandbox = {
      workingDirectory: "/repo",
      exec: async (command: string) => {
        executedCommand = command;
        return {
          success: true,
          exitCode: 0,
          stdout:
            "1700000000\t12\t/repo/src/a.ts\n1690000000\t20\t/repo/src/b.ts",
          stderr: "",
        };
      },
    };

    const result = await globTool().execute?.(
      { pattern: "src/**/*.ts", path: ".", limit: 2 },
      executionOptions(createContext(sandbox)),
    );

    expect(executedCommand).toContain("head -n 2");
    expect(executedCommand).toContain("-name '*.ts'");
    expect(result).toEqual({
      success: true,
      pattern: "src/**/*.ts",
      baseDir: "src",
      count: 2,
      files: [
        {
          path: "src/a.ts",
          size: 12,
          modifiedAt: "2023-11-14T22:13:20.000Z",
        },
        {
          path: "src/b.ts",
          size: 20,
          modifiedAt: "2023-07-22T04:26:40.000Z",
        },
      ],
    });
  });

  test("bashTool handles detached and non-detached execution", async () => {
    const noDetachSandbox = {
      workingDirectory: "/repo",
      exec: async () => ({
        success: true,
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        truncated: true,
      }),
    };

    const detachedUnsupported = await bashTool().execute?.(
      { command: "npm run dev", detached: true },
      executionOptions(createContext(noDetachSandbox)),
    );

    expect(detachedUnsupported).toEqual({
      success: false,
      exitCode: null,
      stdout: "",
      stderr:
        "Detached mode is not supported in this sandbox environment. Only cloud sandboxes support background processes.",
    });

    const detachedSandbox = {
      ...noDetachSandbox,
      execDetached: async () => ({ commandId: "cmd-1" }),
    };

    const detachedResult = await bashTool().execute?.(
      { command: "npm run dev", detached: true },
      executionOptions(createContext(detachedSandbox)),
    );

    expect(detachedResult).toEqual({
      success: true,
      exitCode: null,
      stdout:
        "Process started in background (command ID: cmd-1). The server is now running.",
      stderr: "",
    });

    const normalResult = await bashTool().execute?.(
      { command: "ls" },
      executionOptions(createContext(noDetachSandbox)),
    );

    expect(normalResult).toEqual({
      success: true,
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      truncated: true,
    });
  });

  test("commandNeedsApproval flags only rm -rf commands", () => {
    expect(commandNeedsApproval("ls -la")).toBe(false);
    expect(commandNeedsApproval("git status --short")).toBe(false);
    expect(commandNeedsApproval("npm install")).toBe(false);
    expect(commandNeedsApproval("bun install")).toBe(false);
    expect(commandNeedsApproval("custom-command --help")).toBe(false);
    expect(commandNeedsApproval("git reset --hard HEAD~1")).toBe(false);
    expect(commandNeedsApproval("rm -fr tmp")).toBe(false);
    expect(commandNeedsApproval("rm -rf tmp")).toBe(true);
  });

  test("bashTool needsApproval blocks dangerous commands by default", async () => {
    const baseContext = {
      sandbox: { workingDirectory: "/repo" },
      model: "test-model",
    };

    const safeCommand = await getNeedsApprovalResult(
      bashTool().needsApproval,
      { command: "ls -la" },
      {
        ...baseContext,
      },
    );
    expect(safeCommand).toBe(false);

    const dangerousCommand = await getNeedsApprovalResult(
      bashTool().needsApproval,
      { command: "rm -rf tmp" },
      {
        ...baseContext,
      },
    );
    expect(dangerousCommand).toBe(true);

    const allowedBuildCommand = await getNeedsApprovalResult(
      bashTool().needsApproval,
      { command: "bun run ci" },
      {
        ...baseContext,
      },
    );
    expect(allowedBuildCommand).toBe(false);
  });

  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    sandboxRegistry.clear();
  });

  test("webFetchTool truncates oversized response bodies", async () => {
    globalThis.fetch = ((..._args: Parameters<typeof fetch>) =>
      Promise.resolve(
        new Response("x".repeat(20_050), {
          status: 200,
          statusText: "OK",
          headers: { "x-test": "1" },
        }),
      )) as unknown as typeof fetch;

    const result = await webFetchTool.execute?.(
      {
        url: "https://example.com",
        method: "GET",
      },
      executionOptions(),
    );

    expect(result).toMatchObject({
      success: true,
      status: 200,
      statusText: "OK",
      truncated: true,
      headers: { "x-test": "1" },
    });

    const body =
      result && typeof result === "object" && "body" in result
        ? (result.body as string)
        : "";
    expect(body.length).toBe(20_000);
  });

  test("askUserQuestionTool formats structured answers", () => {
    const answerOutput = askUserQuestionTool.toModelOutput?.({
      toolCallId: "tool-call-1",
      input: { questions: [] },
      output: {
        answers: {
          "Which package manager?": "bun",
          "Which checks?": ["typecheck", "test"],
        },
      },
    });

    expect(answerOutput).toEqual({
      type: "text",
      value:
        'User has answered your questions: "Which package manager?"="bun", "Which checks?"="typecheck, test". You can now continue with the user\'s answers in mind.',
    });

    const declinedOutput = askUserQuestionTool.toModelOutput?.({
      toolCallId: "tool-call-1",
      input: { questions: [] },
      output: { declined: true },
    });

    expect(declinedOutput).toEqual({
      type: "text",
      value:
        "User declined to answer questions. You should continue without this information or ask in a different way.",
    });
  });

  test("skillTool loads skill content and substitutes arguments", async () => {
    const sandbox = {
      workingDirectory: "/repo",
      readFile: async () =>
        "---\nname: review\ndescription: review code\n---\nRun review with $ARGUMENTS",
    };

    const result = await skillTool.execute?.(
      { skill: "Review", args: "--quick" },
      executionOptions({
        ...createContext(sandbox),
        skills: [
          {
            name: "review",
            description: "Review code changes",
            path: "/repo/.skills/review",
            filename: "SKILL.md",
            options: {},
          },
        ],
      }),
    );

    expect(result).toEqual({
      success: true,
      skillName: "Review",
      skillPath: "/repo/.skills/review",
      content:
        "Skill directory: /repo/.skills/review\n\nRun review with --quick",
    });
  });

  test("skillTool returns helpful errors for missing or disabled skills", async () => {
    const sandbox = {
      workingDirectory: "/repo",
      readFile: async () => "skill-body",
    };

    const missingResult = await skillTool.execute?.(
      { skill: "unknown" },
      executionOptions({ ...createContext(sandbox), skills: [] }),
    );

    expect(missingResult).toEqual({
      success: false,
      error: "Skill 'unknown' not found. Available skills: none",
    });

    const disabledResult = await skillTool.execute?.(
      { skill: "commit" },
      executionOptions({
        ...createContext(sandbox),
        skills: [
          {
            name: "commit",
            description: "Create a commit",
            path: "/repo/.skills/commit",
            filename: "SKILL.md",
            options: { disableModelInvocation: true },
          },
        ],
      }),
    );

    expect(disabledResult).toEqual({
      success: false,
      error:
        "Skill 'commit' cannot be invoked by the model (disable-model-invocation is set)",
    });
  });

  test("taskTool exposes both subagent types without approval gates", async () => {
    const explorerNeedsApproval = await getNeedsApprovalResult(
      taskTool.needsApproval,
      {
        subagentType: "explorer",
        task: "Find usages",
        instructions: "Search for helper usage",
      },
      {
        sandbox: { workingDirectory: "/repo" },
        model: "test-model",
        approval: {},
      },
    );
    expect(explorerNeedsApproval).toBe(false);

    const executorNeedsApproval = await getNeedsApprovalResult(
      taskTool.needsApproval,
      {
        subagentType: "executor",
        task: "Apply changes",
        instructions: "Update files",
      },
      {
        sandbox: { workingDirectory: "/repo" },
        model: "test-model",
        approval: {},
      },
    );
    expect(executorNeedsApproval).toBe(false);
  });

  test("todoWriteTool returns updated todo list metadata", async () => {
    const todos = [
      { id: "1", content: "Write tests", status: "in_progress" as const },
      { id: "2", content: "Run checks", status: "pending" as const },
    ];

    const result = await todoWriteTool.execute?.({ todos }, executionOptions());

    expect(result).toEqual({
      success: true,
      message: "Updated task list with 2 items",
      todos,
    });
  });
});
