import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import React from "react";
import { PRIMARY_COLOR } from "../../lib/colors";
import type { ToolRendererProps } from "../../lib/render-tool";
import { truncateText } from "../../lib/truncate";
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
  const isInputReady = part.state !== "input-streaming";
  const todos = part.input?.todos as
    | Array<{ id: string; content: string; status: string }>
    | undefined;
  const todoCount = todos?.length ?? 0;
  const completedCount =
    todos?.filter((t) => t.status === "completed").length ?? 0;
  const inProgressCount =
    todos?.filter((t) => t.status === "in_progress").length ?? 0;
  const summary = isInputReady
    ? `${todoCount} tasks (${completedCount} done, ${inProgressCount} in progress)`
    : "...";
  const { width } = useTerminalDimensions();
  const terminalWidth = width ?? 80;
  const indentWidth = 3;
  const iconWidth = 2;
  const maxTodoWidth = Math.max(10, terminalWidth - indentWidth - iconWidth);

  return (
    <box flexDirection="column">
      <ToolLayout
        name="TodoWrite"
        summary={summary}
        output={
          part.state === "output-available" && (
            <text fg="white">Tasks updated</text>
          )
        }
        state={state}
      />
      {isExpanded && isInputReady && todos && todos.length > 0 && (
        <box flexDirection="column" paddingLeft={3}>
          {todos.map((todo) => (
            <box key={todo.id}>
              <text fg={getTodoColor(todo.status)}>
                {getTodoIcon(todo.status)}{" "}
                {todo.status === "completed" ? (
                  <span attributes={TextAttributes.STRIKETHROUGH}>
                    {truncateText(todo.content, maxTodoWidth)}
                  </span>
                ) : (
                  truncateText(todo.content, maxTodoWidth)
                )}
              </text>
            </box>
          ))}
        </box>
      )}
    </box>
  );
}
