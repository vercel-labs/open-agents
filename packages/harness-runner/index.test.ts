import { describe, expect, test } from "bun:test";
import {
  EXTERNAL_HARNESS_IDS,
  HARNESS_INSTRUCTIONS,
  OPEN_AGENT_HARNESS_TOOLS,
  assembleHarnessResponseMessage,
  buildHarnessPrompt,
  createHarnessAdapter,
  createHarnessStepBoundaryStream,
  extractHarnessCostUsd,
  isExternalHarnessId,
  mapOpenAgentToolChunk,
  resolveClaudeCodeModelId,
  resolveCodexModelId,
  resolvePiModelId,
} from "./index";

async function readChunks(
  stream: ReadableStream<Record<string, unknown>>,
): Promise<Record<string, unknown>[]> {
  const chunks: Record<string, unknown>[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

describe("extractHarnessCostUsd", () => {
  test("reads cumulative Claude Code cost metadata", () => {
    expect(
      extractHarnessCostUsd({
        "claude-code": {
          costUsd: 0.0123,
        },
      }),
    ).toBe(0.0123);
  });

  test("ignores missing or invalid cost metadata", () => {
    expect(extractHarnessCostUsd(undefined)).toBeUndefined();
    expect(
      extractHarnessCostUsd({
        "claude-code": {
          costUsd: "0.0123",
        },
      }),
    ).toBeUndefined();
  });
});

describe("buildHarnessPrompt", () => {
  test("builds a compact transcript from chat text", () => {
    expect(
      buildHarnessPrompt([
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "Inspect the repo" }],
        },
        {
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "I found the issue" }],
        },
        {
          id: "user-2",
          role: "user",
          parts: [{ type: "text", text: "Fix it" }],
        },
      ]),
    ).toBe(
      "User:\nInspect the repo\n\nAssistant:\nI found the issue\n\nUser:\nFix it",
    );
  });

  test("ignores messages without transferable prompt content", () => {
    expect(
      buildHarnessPrompt([
        {
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "tool-bash", state: "output-available" }],
        },
      ]),
    ).toBe("");
  });

  test("includes completed interactive tool outputs", () => {
    expect(
      buildHarnessPrompt([
        {
          id: "assistant-1",
          role: "assistant",
          parts: [
            {
              type: "tool-ask_user_question",
              toolCallId: "question-1",
              state: "output-available",
              input: {
                questions: [
                  {
                    question: "Which direction?",
                    header: "Direction",
                    options: [],
                  },
                ],
              },
              output: {
                answers: {
                  "Which direction?": "Keep it simple",
                },
              },
            },
          ],
        },
      ]),
    ).toBe(
      'Assistant:\nUser answered questions: "Which direction?"="Keep it simple".',
    );
  });
});

describe("resolveCodexModelId", () => {
  test("passes OpenAI models to Codex without the gateway provider prefix", () => {
    expect(resolveCodexModelId("openai/gpt-5.4")).toBe("gpt-5.4");
  });

  test("uses the Codex default for models from another provider", () => {
    expect(resolveCodexModelId("anthropic/claude-opus-4.6")).toBeUndefined();
  });
});

describe("resolveClaudeCodeModelId", () => {
  test("passes Anthropic models to Claude Code without the gateway provider prefix", () => {
    expect(resolveClaudeCodeModelId("anthropic/claude-opus-4.6")).toBe(
      "claude-opus-4.6",
    );
  });

  test("uses the Claude Code default for models from another provider", () => {
    expect(resolveClaudeCodeModelId("openai/gpt-5.4")).toBeUndefined();
  });
});

describe("resolvePiModelId", () => {
  test("preserves the full AI Gateway model id for Pi", () => {
    expect(resolvePiModelId("anthropic/claude-opus-4.6")).toBe(
      "anthropic/claude-opus-4.6",
    );
  });
});

describe("createHarnessAdapter", () => {
  test("creates the Pi harness adapter", () => {
    expect(
      createHarnessAdapter("pi", "anthropic/claude-sonnet-4.6").harnessId,
    ).toBe("pi");
  });
});

describe("isExternalHarnessId", () => {
  test("accepts every external harness id", () => {
    for (const harnessId of EXTERNAL_HARNESS_IDS) {
      expect(isExternalHarnessId(harnessId)).toBeTrue();
    }
  });

  test("rejects the open-agent loop and unknown values", () => {
    expect(isExternalHarnessId("open-agent")).toBeFalse();
    expect(isExternalHarnessId("goose")).toBeFalse();
    expect(isExternalHarnessId(undefined)).toBeFalse();
  });
});

describe("OPEN_AGENT_HARNESS_TOOLS", () => {
  test("exposes ask_user_question as an external client-side tool", () => {
    expect(Object.keys(OPEN_AGENT_HARNESS_TOOLS)).toEqual([
      "ask_user_question",
      "todo_write",
    ]);
    expect("execute" in OPEN_AGENT_HARNESS_TOOLS.ask_user_question).toBeFalse();
  });

  test("exposes todo_write as a local progress-tracking tool", () => {
    expect("execute" in OPEN_AGENT_HARNESS_TOOLS.todo_write).toBeTrue();
  });

  test.each([...EXTERNAL_HARNESS_IDS])(
    "instructs %s to use ask_user_question instead of prose fallback",
    (harnessId) => {
      expect(HARNESS_INSTRUCTIONS[harnessId]).toContain(
        "The ask_user_question tool is available",
      );
      expect(HARNESS_INSTRUCTIONS[harnessId]).toContain(
        "your first assistant action must be an ask_user_question tool call",
      );
    },
  );

  test.each([...EXTERNAL_HARNESS_IDS])(
    "instructs %s to use todo_write for visible task tracking",
    (harnessId) => {
      expect(HARNESS_INSTRUCTIONS[harnessId]).toContain(
        "The todo_write tool is available",
      );
      expect(HARNESS_INSTRUCTIONS[harnessId]).toContain(
        "Only one task should be in_progress at a time",
      );
    },
  );

  test("keeps the Codex MCP relay fallback guidance", () => {
    expect(HARNESS_INSTRUCTIONS.codex).toContain(
      "Do not say that the structured question tool is unavailable",
    );
  });

  test("steers Claude Code away from its built-in TodoWrite tool", () => {
    expect(HARNESS_INSTRUCTIONS["claude-code"]).toContain(
      "instead of your built-in TodoWrite tool",
    );
  });
});

describe("assembleHarnessResponseMessage", () => {
  test("keeps prior parts when seeded with the persisted assistant message", async () => {
    const responseMessage = await assembleHarnessResponseMessage(
      new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "start-step" });
          controller.enqueue({ type: "text-start", id: "text-2" });
          controller.enqueue({
            type: "text-delta",
            id: "text-2",
            delta: "Continuing after your answer.",
          });
          controller.enqueue({ type: "text-end", id: "text-2" });
          controller.close();
        },
      }),
      "assistant-1",
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          { type: "step-start" },
          { type: "text", text: "Earlier answer", state: "done" },
        ],
        metadata: { totalMessageUsage: { inputTokens: 10 } },
      },
    );

    expect(responseMessage.parts).toEqual([
      { type: "step-start" },
      { type: "text", text: "Earlier answer", state: "done" },
      { type: "step-start" },
      {
        type: "text",
        text: "Continuing after your answer.",
        state: "done",
      },
    ]);
    expect(responseMessage.metadata).toEqual({
      totalMessageUsage: { inputTokens: 10 },
    });
  });

  test("ignores a seed message from a different assistant id", async () => {
    const responseMessage = await assembleHarnessResponseMessage(
      new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-start", id: "text-1" });
          controller.enqueue({
            type: "text-delta",
            id: "text-1",
            delta: "Fresh turn",
          });
          controller.enqueue({ type: "text-end", id: "text-1" });
          controller.close();
        },
      }),
      "assistant-2",
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Old message", state: "done" }],
      },
    );

    expect(responseMessage.parts).toEqual([
      { type: "text", text: "Fresh turn", state: "done" },
    ]);
  });

  test("assembles persisted assistant parts from UI stream chunks", async () => {
    const responseMessage = await assembleHarnessResponseMessage(
      new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "start-step" });
          controller.enqueue({ type: "text-start", id: "text-1" });
          controller.enqueue({
            type: "text-delta",
            id: "text-1",
            delta: "Hello from Codex",
          });
          controller.enqueue({ type: "text-end", id: "text-1" });
          controller.enqueue({ type: "finish-step" });
          controller.close();
        },
      }),
      "assistant-1",
    );

    expect(responseMessage).toEqual({
      id: "assistant-1",
      role: "assistant",
      parts: [
        { type: "step-start" },
        { type: "text", text: "Hello from Codex", state: "done" },
      ],
    });
  });

  test("assembles native harness tool calls and results", async () => {
    const responseMessage = await assembleHarnessResponseMessage(
      new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "tool-input-available",
            toolCallId: "tool-1",
            toolName: "bash",
            input: { command: "pwd" },
            dynamic: true,
          });
          controller.enqueue({
            type: "tool-output-available",
            toolCallId: "tool-1",
            output: { exitCode: 0, output: "/vercel/sandbox\n" },
            dynamic: true,
          });
          controller.close();
        },
      }),
      "assistant-1",
    );

    expect(responseMessage.parts).toEqual([
      {
        type: "tool-bash",
        toolCallId: "tool-1",
        state: "output-available",
        input: { command: "pwd" },
        output: { exitCode: 0, output: "/vercel/sandbox\n" },
      },
    ]);
  });

  test("keeps paused user questions available for client answers", async () => {
    const responseMessage = await assembleHarnessResponseMessage(
      new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "tool-input-available",
            toolCallId: "question-1",
            toolName: "ask_user_question",
            input: {
              questions: [
                {
                  question: "Which direction?",
                  header: "Direction",
                  options: [],
                },
              ],
            },
            dynamic: true,
          });
          controller.enqueue({
            type: "tool-approval-request",
            toolCallId: "question-1",
            approvalId: "approval-1",
          });
          controller.enqueue({ type: "finish-step" });
          controller.close();
        },
      }),
      "assistant-1",
    );

    expect(responseMessage.parts).toEqual([
      expect.objectContaining({
        type: "tool-ask_user_question",
        toolCallId: "question-1",
        state: "input-available",
        input: {
          questions: [
            {
              question: "Which direction?",
              header: "Direction",
              options: [],
            },
          ],
        },
      }),
    ]);
  });
});

describe("createHarnessStepBoundaryStream", () => {
  test("prepends a missing step boundary", async () => {
    const chunks = await readChunks(
      new ReadableStream<Record<string, unknown>>({
        start(controller) {
          controller.enqueue({ type: "text-start", id: "text-1" });
          controller.close();
        },
      }).pipeThrough(createHarnessStepBoundaryStream()),
    );

    expect(chunks).toEqual([
      { type: "start-step" },
      { type: "text-start", id: "text-1" },
    ]);
  });

  test("does not duplicate an existing step boundary", async () => {
    const chunks = await readChunks(
      new ReadableStream<Record<string, unknown>>({
        start(controller) {
          controller.enqueue({ type: "start-step" });
          controller.enqueue({ type: "text-start", id: "text-1" });
          controller.close();
        },
      }).pipeThrough(createHarnessStepBoundaryStream()),
    );

    expect(chunks).toEqual([
      { type: "start-step" },
      { type: "text-start", id: "text-1" },
    ]);
  });
});

describe("mapOpenAgentToolChunk", () => {
  test.each([
    "todo_write",
    "read",
    "write",
    "edit",
    "grep",
    "glob",
    "bash",
    "task",
    "ask_user_question",
    "skill",
    "web_fetch",
  ])("maps known Open Agents tool %s to a static tool chunk", (toolName) => {
    expect(
      mapOpenAgentToolChunk({
        type: "tool-input-available",
        toolCallId: "tool-1",
        toolName,
        input: {},
        dynamic: true,
      }),
    ).toEqual({
      type: "tool-input-available",
      toolCallId: "tool-1",
      toolName,
      input: {},
    });
  });

  test("maps streaming input starts before the part is created", () => {
    expect(
      mapOpenAgentToolChunk({
        type: "tool-input-start",
        toolCallId: "tool-1",
        toolName: "ask_user_question",
        dynamic: true,
      }),
    ).toEqual({
      type: "tool-input-start",
      toolCallId: "tool-1",
      toolName: "ask_user_question",
    });
  });

  test("preserves unknown dynamic tools", () => {
    expect(
      mapOpenAgentToolChunk({
        type: "tool-input-available",
        toolCallId: "tool-1",
        toolName: "custom_tool",
        input: {},
        dynamic: true,
      }),
    ).toEqual({
      type: "tool-input-available",
      toolCallId: "tool-1",
      toolName: "custom_tool",
      input: {},
      dynamic: true,
    });
  });
});
