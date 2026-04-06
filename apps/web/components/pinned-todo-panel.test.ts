import { describe, expect, test } from "bun:test";
import type { WebAgentUIMessage } from "@/app/types";
import { getLatestTodos, type TodoItem } from "./pinned-todo-panel";

function createMessage(parts: unknown[]): WebAgentUIMessage {
  return {
    id: "message-id",
    role: "assistant",
    parts,
  } as unknown as WebAgentUIMessage;
}

describe("getLatestTodos", () => {
  test("keeps showing the previous todos while a new todo update is still streaming", () => {
    const previousTodos: TodoItem[] = [
      { id: "1", content: "Inspect files", status: "completed" },
      { id: "2", content: "Implement fix", status: "in_progress" },
    ];
    const streamingTodos: TodoItem[] = [
      { id: "1", content: "Inspect files", status: "completed" },
      { id: "2", content: "Implement fix", status: "completed" },
    ];

    const latestTodos = getLatestTodos([
      createMessage([
        {
          type: "tool-todo_write",
          state: "input-available",
          input: { todos: previousTodos },
        },
      ]),
      createMessage([
        {
          type: "tool-todo_write",
          state: "input-streaming",
          input: { todos: streamingTodos },
        },
      ]),
    ]);

    expect(latestTodos).toEqual(previousTodos);
  });

  test("swaps to the newest todos once the todo input is fully available", () => {
    const previousTodos: TodoItem[] = [
      { id: "1", content: "Inspect files", status: "completed" },
      { id: "2", content: "Implement fix", status: "in_progress" },
    ];
    const updatedTodos: TodoItem[] = [
      { id: "1", content: "Inspect files", status: "completed" },
      { id: "2", content: "Implement fix", status: "completed" },
      { id: "3", content: "Run checks", status: "in_progress" },
    ];

    const latestTodos = getLatestTodos([
      createMessage([
        {
          type: "tool-todo_write",
          state: "input-available",
          input: { todos: previousTodos },
        },
      ]),
      createMessage([
        {
          type: "tool-todo_write",
          state: "input-available",
          input: { todos: updatedTodos },
        },
      ]),
    ]);

    expect(latestTodos).toEqual(updatedTodos);
  });
});
