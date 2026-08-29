import { describe, expect, test } from "bun:test";
import {
  askUserQuestionInputSchema,
  todoWriteInputSchema,
  type TodoWriteInput,
} from "@open-agents/shared/lib/chat-tools";
import { OPEN_AGENT_HARNESS_TOOLS } from "./tools.ts";

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

  test("uses the shared zod schemas as tool input schemas", () => {
    expect(OPEN_AGENT_HARNESS_TOOLS.ask_user_question.inputSchema).toBe(
      askUserQuestionInputSchema,
    );
    expect(OPEN_AGENT_HARNESS_TOOLS.todo_write.inputSchema).toBe(
      todoWriteInputSchema,
    );
  });

  test("todo_write normalizes malformed inputs before reporting", async () => {
    const execute = OPEN_AGENT_HARNESS_TOOLS.todo_write.execute;
    if (!execute) {
      throw new Error("todo_write must have an execute function");
    }

    // Simulate a bridge delivering a stringified payload despite the schema.
    const malformedInput = JSON.stringify({
      todos: [{ content: "Run checks", status: "in_progress" }],
    }) as unknown as TodoWriteInput;
    const result = await execute(malformedInput, {
      toolCallId: "tool-1",
      messages: [],
      context: undefined,
    });

    expect(result).toEqual({
      success: true,
      message: "Updated task list with 1 items",
      todos: [{ id: "todo-0", content: "Run checks", status: "in_progress" }],
    });
  });
});
