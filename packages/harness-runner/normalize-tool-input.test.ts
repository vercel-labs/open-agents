import { describe, expect, test } from "bun:test";
import type { TodoItem } from "@open-agents/shared/lib/chat-tools";
import {
  normalizeAskUserQuestionInput,
  normalizeTodoWriteInput,
} from "./normalize-tool-input.ts";

const validTodos: TodoItem[] = [
  { id: "1", content: "Inspect files", status: "completed" },
  { id: "2", content: "Implement fix", status: "in_progress" },
];

describe("normalizeTodoWriteInput", () => {
  test("passes through well-formed input", () => {
    expect(normalizeTodoWriteInput({ todos: validTodos })).toEqual({
      todos: validTodos,
    });
  });

  test("parses stringified input and todos fields", () => {
    expect(
      normalizeTodoWriteInput(
        JSON.stringify({ todos: JSON.stringify(validTodos) }),
      ),
    ).toEqual({ todos: validTodos });
  });

  test("wraps a single todo object into an array", () => {
    expect(normalizeTodoWriteInput({ todos: validTodos[0] })).toEqual({
      todos: [validTodos[0] as TodoItem],
    });
  });

  test("repairs incomplete todo items", () => {
    expect(
      normalizeTodoWriteInput({
        todos: [{ content: "Run checks", status: "unknown" }, "Deploy preview"],
      }),
    ).toEqual({
      todos: [
        { id: "todo-0", content: "Run checks", status: "pending" },
        { id: "todo-1", content: "Deploy preview", status: "pending" },
      ],
    });
  });

  test("accepts a root todo array", () => {
    expect(normalizeTodoWriteInput(validTodos)).toEqual({ todos: validTodos });
  });

  test("drops unsalvageable values", () => {
    expect(normalizeTodoWriteInput(undefined)).toEqual({ todos: [] });
    expect(normalizeTodoWriteInput("not json")).toEqual({ todos: [] });
    expect(normalizeTodoWriteInput({ todos: 42 })).toEqual({ todos: [] });
    expect(normalizeTodoWriteInput({ todos: [{ status: "pending" }] })).toEqual(
      { todos: [] },
    );
  });
});

const validQuestion = {
  question: "Which direction?",
  header: "Direction",
  options: [
    { label: "Simple", description: "Keep it minimal" },
    { label: "Full", description: "Build everything" },
  ],
  multiSelect: false,
};

describe("normalizeAskUserQuestionInput", () => {
  test("passes through well-formed input", () => {
    expect(
      normalizeAskUserQuestionInput({ questions: [validQuestion] }),
    ).toEqual({ questions: [validQuestion] });
  });

  test("parses a stringified input payload", () => {
    expect(
      normalizeAskUserQuestionInput(
        JSON.stringify({ questions: [validQuestion] }),
      ),
    ).toEqual({ questions: [validQuestion] });
  });

  test("parses stringified questions and options fields", () => {
    expect(
      normalizeAskUserQuestionInput({
        questions: JSON.stringify([
          { ...validQuestion, options: JSON.stringify(validQuestion.options) },
        ]),
      }),
    ).toEqual({ questions: [validQuestion] });
  });

  test("wraps a single question object into an array", () => {
    expect(normalizeAskUserQuestionInput({ questions: validQuestion })).toEqual(
      { questions: [validQuestion] },
    );
  });

  test("repairs missing fields instead of crashing", () => {
    expect(
      normalizeAskUserQuestionInput({
        questions: [{ question: "Proceed with the migration?" }],
      }),
    ).toEqual({
      questions: [
        {
          question: "Proceed with the migration?",
          header: "Proceed with",
          options: [],
          multiSelect: false,
        },
      ],
    });
  });

  test("truncates over-long headers to the shared limit", () => {
    expect(
      normalizeAskUserQuestionInput({
        questions: [
          { ...validQuestion, header: "An extremely long header label" },
        ],
      }),
    ).toEqual({
      questions: [{ ...validQuestion, header: "An extremely" }],
    });
  });

  test("coerces string options into labels", () => {
    expect(
      normalizeAskUserQuestionInput({
        questions: [{ ...validQuestion, options: ["Yes", "No"] }],
      }),
    ).toEqual({
      questions: [
        {
          ...validQuestion,
          options: [
            { label: "Yes", description: "" },
            { label: "No", description: "" },
          ],
        },
      ],
    });
  });

  test("drops unsalvageable values", () => {
    expect(normalizeAskUserQuestionInput(undefined)).toEqual({ questions: [] });
    expect(normalizeAskUserQuestionInput("not json")).toEqual({
      questions: [],
    });
    expect(normalizeAskUserQuestionInput({ questions: 42 })).toEqual({
      questions: [],
    });
    expect(
      normalizeAskUserQuestionInput({ questions: [{ header: "No text" }] }),
    ).toEqual({ questions: [] });
  });
});
