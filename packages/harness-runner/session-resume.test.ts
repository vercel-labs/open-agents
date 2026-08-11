import { describe, expect, test } from "bun:test";
import type { HarnessAgentResumeSessionState } from "@ai-sdk/harness/agent";

import {
  collectPendingToolResultContinuations,
  parseHarnessResumeState,
} from "./session-resume.ts";

function createResumeState(
  overrides: Partial<HarnessAgentResumeSessionState> = {},
): HarnessAgentResumeSessionState {
  return {
    type: "resume-session",
    harnessId: "claude-code",
    specificationVersion: "harness-v1",
    data: { sessionRef: "abc" },
    ...overrides,
  } as HarnessAgentResumeSessionState;
}

describe("parseHarnessResumeState", () => {
  test("accepts resume state from the same harness", () => {
    const state = createResumeState();
    expect(parseHarnessResumeState(state, "claude-code")).toBe(state);
  });

  test("rejects state from another harness or malformed values", () => {
    expect(
      parseHarnessResumeState(createResumeState(), "codex"),
    ).toBeUndefined();
    expect(parseHarnessResumeState(null, "codex")).toBeUndefined();
    expect(parseHarnessResumeState("resume-session", "codex")).toBeUndefined();
    expect(
      parseHarnessResumeState({ type: "continue-turn" }, "codex"),
    ).toBeUndefined();
  });
});

describe("collectPendingToolResultContinuations", () => {
  const pendingQuestion = {
    toolCallId: "question-1",
    toolName: "ask_user_question",
    input: "{}",
  };

  test("returns undefined when the session has no pending tool results", () => {
    expect(
      collectPendingToolResultContinuations(createResumeState(), []),
    ).toBeUndefined();
  });

  test("collects answered question outputs from the chat history", () => {
    const state = createResumeState({
      continueFrom: {
        type: "continue-turn",
        harnessId: "claude-code",
        specificationVersion: "harness-v1",
        data: {},
        pendingToolResults: [pendingQuestion],
      },
    });

    const continuations = collectPendingToolResultContinuations(state, [
      {
        role: "assistant",
        parts: [
          {
            type: "tool-ask_user_question",
            toolCallId: "question-1",
            state: "output-available",
            output: { answers: { "Which direction?": "North" } },
          },
        ],
      },
    ]);

    expect(continuations).toEqual([
      {
        toolCallId: "question-1",
        output: { answers: { "Which direction?": "North" } },
      },
    ]);
  });

  test("returns undefined when a pending result has no answer yet", () => {
    const state = createResumeState({
      continueFrom: {
        type: "continue-turn",
        harnessId: "claude-code",
        specificationVersion: "harness-v1",
        data: {},
        pendingToolResults: [pendingQuestion],
      },
    });

    const continuations = collectPendingToolResultContinuations(state, [
      {
        role: "assistant",
        parts: [
          {
            type: "tool-ask_user_question",
            toolCallId: "question-1",
            state: "input-available",
          },
        ],
      },
    ]);

    expect(continuations).toBeUndefined();
  });
});
