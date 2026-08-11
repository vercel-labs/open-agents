import { describe, expect, test } from "bun:test";
import { parseAskUserQuestionInput, parseTodoWriteInput } from "./tool-input";

describe("parseTodoWriteInput", () => {
  test("returns the todos for a well-formed input", () => {
    expect(
      parseTodoWriteInput({
        todos: [{ id: "1", content: "Inspect files", status: "in_progress" }],
      }),
    ).toEqual([{ id: "1", content: "Inspect files", status: "in_progress" }]);
  });

  test("returns undefined for partial or malformed input", () => {
    expect(parseTodoWriteInput(undefined)).toBeUndefined();
    expect(parseTodoWriteInput({})).toBeUndefined();
    expect(parseTodoWriteInput({ todos: "not-an-array" })).toBeUndefined();
    expect(
      parseTodoWriteInput({ todos: [{ content: "missing id and status" }] }),
    ).toBeUndefined();
  });
});

describe("parseAskUserQuestionInput", () => {
  test("returns the input for a well-formed payload", () => {
    const input = {
      questions: [
        {
          question: "Which approach?",
          header: "Approach",
          options: [
            { label: "Option A", description: "First" },
            { label: "Option B", description: "Second" },
          ],
          multiSelect: false,
        },
      ],
    };

    expect(parseAskUserQuestionInput(input)).toEqual(input);
  });

  test("returns undefined for partial or malformed input", () => {
    expect(parseAskUserQuestionInput(undefined)).toBeUndefined();
    expect(parseAskUserQuestionInput({})).toBeUndefined();
    expect(parseAskUserQuestionInput({ questions: [] })).toBeUndefined();
    expect(
      parseAskUserQuestionInput({
        questions: [{ question: "No options?" }],
      }),
    ).toBeUndefined();
  });
});
