import { describe, expect, test } from "bun:test";
import type { UIMessageChunk } from "ai";
import {
  assembleHarnessResponseMessage,
  createHarnessStepBoundaryStream,
  createOpenAgentToolMappingStream,
  mapOpenAgentToolChunk,
  normalizeToolInputChunk,
} from "./chunk-streams.ts";

function chunkStream(chunks: UIMessageChunk[]): ReadableStream<UIMessageChunk> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

async function readChunks(
  stream: ReadableStream<UIMessageChunk>,
): Promise<UIMessageChunk[]> {
  const chunks: UIMessageChunk[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      return chunks;
    }
    chunks.push(value);
  }
}

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

describe("normalizeToolInputChunk", () => {
  test("normalizes malformed todo_write inputs", () => {
    expect(
      normalizeToolInputChunk({
        type: "tool-input-available",
        toolCallId: "tool-1",
        toolName: "todo_write",
        input: JSON.stringify({
          todos: [{ content: "Run checks", status: "unknown" }],
        }),
      }),
    ).toEqual({
      type: "tool-input-available",
      toolCallId: "tool-1",
      toolName: "todo_write",
      input: {
        todos: [{ id: "todo-0", content: "Run checks", status: "pending" }],
      },
    });
  });

  test("normalizes malformed ask_user_question inputs", () => {
    expect(
      normalizeToolInputChunk({
        type: "tool-input-available",
        toolCallId: "question-1",
        toolName: "ask_user_question",
        input: { questions: { question: "Proceed with the migration?" } },
      }),
    ).toEqual({
      type: "tool-input-available",
      toolCallId: "question-1",
      toolName: "ask_user_question",
      input: {
        questions: [
          {
            question: "Proceed with the migration?",
            header: "Proceed with",
            options: [],
            multiSelect: false,
          },
        ],
      },
    });
  });

  test("leaves other tools untouched", () => {
    const chunk: UIMessageChunk = {
      type: "tool-input-available",
      toolCallId: "tool-1",
      toolName: "bash",
      input: { command: "pwd" },
    };
    expect(normalizeToolInputChunk(chunk)).toBe(chunk);
  });
});

describe("createOpenAgentToolMappingStream", () => {
  test("maps, normalizes, and suppresses paused-question approvals", async () => {
    const chunks = await readChunks(
      chunkStream([
        {
          type: "tool-input-available",
          toolCallId: "question-1",
          toolName: "ask_user_question",
          input: JSON.stringify({
            questions: [{ question: "Which direction?", header: "Direction" }],
          }),
          dynamic: true,
        },
        {
          type: "tool-approval-request",
          toolCallId: "question-1",
          approvalId: "approval-1",
        },
        {
          type: "tool-approval-request",
          toolCallId: "tool-2",
          approvalId: "approval-2",
        },
      ]).pipeThrough(createOpenAgentToolMappingStream()),
    );

    expect(chunks).toEqual([
      {
        type: "tool-input-available",
        toolCallId: "question-1",
        toolName: "ask_user_question",
        input: {
          questions: [
            {
              question: "Which direction?",
              header: "Direction",
              options: [],
              multiSelect: false,
            },
          ],
        },
      },
      {
        type: "tool-approval-request",
        toolCallId: "tool-2",
        approvalId: "approval-2",
      },
    ]);
  });
});

describe("createHarnessStepBoundaryStream", () => {
  test("prepends a missing step boundary", async () => {
    const chunks = await readChunks(
      chunkStream([{ type: "text-start", id: "text-1" }]).pipeThrough(
        createHarnessStepBoundaryStream(),
      ),
    );

    expect(chunks).toEqual([
      { type: "start-step" },
      { type: "text-start", id: "text-1" },
    ]);
  });

  test("does not duplicate an existing step boundary", async () => {
    const chunks = await readChunks(
      chunkStream([
        { type: "start-step" },
        { type: "text-start", id: "text-1" },
      ]).pipeThrough(createHarnessStepBoundaryStream()),
    );

    expect(chunks).toEqual([
      { type: "start-step" },
      { type: "text-start", id: "text-1" },
    ]);
  });
});

describe("assembleHarnessResponseMessage", () => {
  test("keeps prior parts when seeded with the persisted assistant message", async () => {
    const responseMessage = await assembleHarnessResponseMessage(
      chunkStream([
        { type: "start-step" },
        { type: "text-start", id: "text-2" },
        {
          type: "text-delta",
          id: "text-2",
          delta: "Continuing after your answer.",
        },
        { type: "text-end", id: "text-2" },
      ]),
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
      chunkStream([
        { type: "text-start", id: "text-1" },
        { type: "text-delta", id: "text-1", delta: "Fresh turn" },
        { type: "text-end", id: "text-1" },
      ]),
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
      chunkStream([
        { type: "start-step" },
        { type: "text-start", id: "text-1" },
        { type: "text-delta", id: "text-1", delta: "Hello from Codex" },
        { type: "text-end", id: "text-1" },
        { type: "finish-step" },
      ]),
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

  test("assembles native harness tool calls from the prepared stream", async () => {
    const responseMessage = await assembleHarnessResponseMessage(
      chunkStream([
        {
          type: "tool-input-available",
          toolCallId: "tool-1",
          toolName: "bash",
          input: { command: "pwd" },
          dynamic: true,
        },
        {
          type: "tool-output-available",
          toolCallId: "tool-1",
          output: { exitCode: 0, output: "/vercel/sandbox\n" },
          dynamic: true,
        },
      ]).pipeThrough(createOpenAgentToolMappingStream()),
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
      chunkStream([
        {
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
        },
        {
          type: "tool-approval-request",
          toolCallId: "question-1",
          approvalId: "approval-1",
        },
        { type: "finish-step" },
      ]).pipeThrough(createOpenAgentToolMappingStream()),
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
              multiSelect: false,
            },
          ],
        },
      }),
    ]);
  });
});
