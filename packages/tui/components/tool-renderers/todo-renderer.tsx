import { TextAttributes } from "@opentui/core";
import React from "react";
import { PRIMARY_COLOR } from "../../lib/colors";
import type { ToolRendererProps } from "../../lib/render-tool";
import { ToolLayout } from "./shared";

function getTodoIcon(status: string) {
  switch (status) {
    case "completed":
      return "☒";
    case "in_progress":
      return "◎";
    default:
      return "☐";
  }
}

function getTodoColor(status: string) {
  switch (status) {
    case "completed":
      return "gray";
    case "in_progress":
      return PRIMARY_COLOR;
    default:
      return "white";
  }
}

export function TodoRenderer({
  part,
  state,
  isExpanded = false,
}: ToolRendererProps<"tool-todo_write">) {
  const todos = part.input?.todos as
    | Array<{ id: string; content: string; status: string }>
    | undefined;
  const todoCount = todos?.length ?? 0;
  const completedCount =
    todos?.filter((t) => t.status === "completed").length ?? 0;
  const inProgressCount =
    todos?.filter((t) => t.status === "in_progress").length ?? 0;

  return (
    <box flexDirection="column">
      <ToolLayout
        name="TodoWrite"
        summary={`${todoCount} tasks (${completedCount} done, ${inProgressCount} in progress)`}
        output={
          part.state === "output-available" && (
            <text fg="white">Tasks updated</text>
          )
        }
        state={state}
      />
      {isExpanded && todos && todos.length > 0 && (
        <box flexDirection="column" paddingLeft={3}>
          {todos.map((todo) => (
            <box key={todo.id}>
              <text fg={getTodoColor(todo.status)}>
                {getTodoIcon(todo.status)}{" "}
                {todo.status === "completed" ? (
                  <span attributes={TextAttributes.STRIKETHROUGH}>
                    {todo.content}
                  </span>
                ) : (
                  todo.content
                )}
              </text>
            </box>
          ))}
        </box>
      )}
    </box>
  );
}
