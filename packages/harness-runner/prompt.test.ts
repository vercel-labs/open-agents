import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";
import { buildHarnessPrompt } from "./prompt.ts";

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
          parts: [
            { type: "tool-bash", state: "output-available" },
          ] as unknown as UIMessage["parts"],
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
      'Assistant:\nUser has answered your questions: "Which direction?"="Keep it simple". You can now continue with the user\'s answers in mind.',
    );
  });

  test("includes declined question outputs", () => {
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
              input: { questions: [] },
              output: { declined: true },
            },
          ],
        },
      ]),
    ).toBe(
      "Assistant:\nUser declined to answer questions. You should continue without this information or ask in a different way.",
    );
  });

  test("includes approval responses for tool calls", () => {
    expect(
      buildHarnessPrompt([
        {
          id: "assistant-1",
          role: "assistant",
          parts: [
            {
              type: "tool-bash",
              toolCallId: "tool-1",
              state: "approval-responded",
              input: { command: "rm -rf /tmp/scratch" },
              approval: { id: "approval-1", approved: false, reason: "nope" },
            },
          ],
        },
      ]),
    ).toBe("Assistant:\nUser denied the bash tool call. Reason: nope");
  });
});
