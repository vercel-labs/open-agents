import { describe, expect, test } from "bun:test";
import type { WebAgentUIMessage } from "@/app/types";
import { shouldAutoSubmitChat } from "./chat-auto-submit";

function assistantMessage(
  parts: WebAgentUIMessage["parts"],
): WebAgentUIMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    parts,
  };
}

describe("shouldAutoSubmitChat", () => {
  test("waits while a client question needs an answer", () => {
    expect(
      shouldAutoSubmitChat({
        messages: [
          assistantMessage([
            { type: "step-start" },
            {
              type: "tool-ask_user_question",
              toolCallId: "question-1",
              state: "input-available",
              input: { questions: [] },
              providerExecuted: false,
            },
          ]),
        ],
      }),
    ).toBe(false);
  });

  test("continues once the current step client tool is answered", () => {
    expect(
      shouldAutoSubmitChat({
        messages: [
          assistantMessage([
            { type: "step-start" },
            {
              type: "tool-ask_user_question",
              toolCallId: "question-1",
              state: "output-available",
              input: { questions: [] },
              output: { answers: {} },
              providerExecuted: false,
            },
          ]),
        ],
      }),
    ).toBe(true);
  });

  test("does not replay a completed legacy tool after assistant text", () => {
    expect(
      shouldAutoSubmitChat({
        messages: [
          assistantMessage([
            {
              type: "tool-ask_user_question",
              toolCallId: "question-1",
              state: "output-available",
              input: { questions: [] },
              output: { answers: {} },
              providerExecuted: false,
            },
            {
              type: "text",
              text: "Thanks, I have everything I need.",
              state: "done",
            },
          ]),
        ],
      }),
    ).toBe(false);
  });

  test("continues a legacy question when its answered tool is trailing", () => {
    expect(
      shouldAutoSubmitChat({
        messages: [
          assistantMessage([
            {
              type: "text",
              text: "One more question.",
              state: "done",
            },
            {
              type: "tool-ask_user_question",
              toolCallId: "question-1",
              state: "output-available",
              input: { questions: [] },
              output: { answers: {} },
              providerExecuted: false,
            },
          ]),
        ],
      }),
    ).toBe(true);
  });

  test("ignores completed tools before the current step boundary", () => {
    expect(
      shouldAutoSubmitChat({
        messages: [
          assistantMessage([
            {
              type: "tool-ask_user_question",
              toolCallId: "question-1",
              state: "output-available",
              input: { questions: [] },
              output: { answers: {} },
              providerExecuted: false,
            },
            { type: "step-start" },
            {
              type: "text",
              text: "Finished.",
              state: "done",
            },
          ]),
        ],
      }),
    ).toBe(false);
  });
});
