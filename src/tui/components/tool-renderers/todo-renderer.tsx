import React from "react";
import { Box, Text } from "ink";
import type { ToolRendererProps } from "../../lib/render-tool.js";
import { ToolLayout } from "./shared.js";

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
      return "yellow";
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
    <Box flexDirection="column">
      <ToolLayout
        name="TodoWrite"
        summary={`${todoCount} tasks (${completedCount} done, ${inProgressCount} in progress)`}
        output={
          part.state === "output-available" && (
            <Text color="white">Tasks updated</Text>
          )
        }
        state={state}
      />
      {isExpanded && todos && todos.length > 0 && (
        <Box flexDirection="column" paddingLeft={3}>
          {todos.map((todo) => (
            <Box key={todo.id}>
              <Text color={getTodoColor(todo.status)}>
                {getTodoIcon(todo.status)}{" "}
                {todo.status === "completed" ? (
                  <Text strikethrough>{todo.content}</Text>
                ) : (
                  todo.content
                )}
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
