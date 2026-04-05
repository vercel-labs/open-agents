"use client";

import { ListTodo } from "lucide-react";
import type { ToolRendererProps } from "@/app/lib/render-tool";
import { ToolLayout } from "../tool-layout";

export function TodoRenderer({
  part,
  state,
}: ToolRendererProps<"tool-todo_write">) {
  const input = part.input;
  const todos = input?.todos ?? [];

  const activeTodo = todos.find((todo) => todo?.status === "in_progress");
  const completedCount = todos.filter(
    (todo) => todo?.status === "completed",
  ).length;
  const allDone = completedCount === todos.length && todos.length > 0;

  let name: string;
  let summary: string;

  if (activeTodo?.content) {
    name = activeTodo.content;
    summary = "→ in progress";
  } else if (allDone) {
    name = "All tasks completed";
    summary = "✓";
  } else {
    name = `${todos.length} task${todos.length !== 1 ? "s" : ""} updated`;
    summary = `${completedCount}/${todos.length} done`;
  }

  return (
    <ToolLayout
      name={name}
      icon={<ListTodo className="h-3.5 w-3.5" />}
      summary={summary}
      state={state}
    />
  );
}
