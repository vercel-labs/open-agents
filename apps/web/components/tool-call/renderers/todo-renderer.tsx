"use client";

import { LayoutList, ListChecks, ListTodo } from "lucide-react";
import type { ReactNode } from "react";
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
  const noneStarted = completedCount === 0 && !activeTodo;

  let name: string;
  let summary: string;
  let icon: ReactNode;

  if (allDone) {
    name = "All tasks completed";
    summary = "✓";
    icon = <ListChecks className="h-3.5 w-3.5" />;
  } else if (activeTodo?.content) {
    name = activeTodo.content;
    summary = "→ in progress";
    icon = <ListTodo className="h-3.5 w-3.5" />;
  } else if (noneStarted) {
    name = `${todos.length} task${todos.length !== 1 ? "s" : ""} created`;
    summary = "";
    icon = <LayoutList className="h-3.5 w-3.5" />;
  } else {
    name = `${todos.length} task${todos.length !== 1 ? "s" : ""} updated`;
    summary = `${completedCount}/${todos.length} done`;
    icon = <ListTodo className="h-3.5 w-3.5" />;
  }

  return <ToolLayout name={name} icon={icon} summary={summary} state={state} />;
}
