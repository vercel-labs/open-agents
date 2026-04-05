"use client";

import type { ToolRendererProps } from "@/app/lib/render-tool";
import { ToolLayout } from "../tool-layout";

export function TodoRenderer({
  part,
  state,
}: ToolRendererProps<"tool-todo_write">) {
  const input = part.input;
  const todos = input?.todos ?? [];

  const completedCount = todos.filter(
    (todo) => todo?.status === "completed",
  ).length;
  const inProgressCount = todos.filter(
    (todo) => todo?.status === "in_progress",
  ).length;
  const pendingCount = todos.filter(
    (todo) => todo?.status === "pending",
  ).length;

  // Build a concise summary of what this update represents
  const activeTodo = todos.find((todo) => todo?.status === "in_progress");
  let summary: string;

  if (activeTodo?.content) {
    summary = `▶ ${activeTodo.content}`;
  } else if (completedCount === todos.length && todos.length > 0) {
    summary = "All tasks completed";
  } else {
    summary = `${todos.length} task${todos.length !== 1 ? "s" : ""}`;
  }

  const metaParts = [
    completedCount > 0 ? `${completedCount} done` : null,
    inProgressCount > 0 ? `${inProgressCount} active` : null,
    pendingCount > 0 ? `${pendingCount} pending` : null,
  ].filter(Boolean);

  return (
    <ToolLayout
      name="Update tasks"
      summary={summary}
      meta={metaParts.length > 0 ? metaParts.join(" · ") : undefined}
      state={state}
    />
  );
}
