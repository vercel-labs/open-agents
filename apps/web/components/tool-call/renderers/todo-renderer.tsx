"use client";

import { CheckSquare, Circle, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolRendererProps } from "@/app/lib/render-tool";
import { ToolLayout } from "../tool-layout";

export function TodoRenderer({
  part,
  state,
}: ToolRendererProps<"tool-todo_write">) {
  const input = part.input;
  const todos = input?.todos ?? [];
  const keyPrefix = part.toolCallId ?? "todo";

  const completedCount = todos.filter(
    (todo) => todo?.status === "completed",
  ).length;
  const inProgressCount = todos.filter(
    (todo) => todo?.status === "in_progress",
  ).length;
  const pendingCount = todos.filter(
    (todo) => todo?.status === "pending",
  ).length;

  const activeTodoIndex = todos.findIndex(
    (todo) => todo?.status === "in_progress",
  );
  const activeTodo = activeTodoIndex >= 0 ? todos[activeTodoIndex] : undefined;
  const activeTodoContent = activeTodo?.content?.trim();
  const summary = activeTodoContent
    ? activeTodoContent
    : `${todos.length} item${todos.length === 1 ? "" : "s"}`;
  const metaParts = [
    inProgressCount > 0 ? `${inProgressCount} in progress` : null,
    pendingCount > 0 ? `${pendingCount} pending` : null,
    completedCount > 0 ? `${completedCount} done` : null,
  ].filter(Boolean);
  const progressMeta =
    activeTodoContent && activeTodoIndex >= 0 ? (
      <span className="font-mono tabular-nums text-muted-foreground">
        [{activeTodoIndex + 1}/{todos.length}]
      </span>
    ) : undefined;

  const expandedContent =
    todos.length > 0 ? (
      <div className="space-y-1">
        {(() => {
          const todoContentCounts = new Map<string, number>();
          return todos.map((todo) => {
            if (!todo) return null;

            const contentKey = todo.content ?? "";
            const occurrence = todoContentCounts.get(contentKey) ?? 0;
            todoContentCounts.set(contentKey, occurrence + 1);

            return (
              <div
                key={`${keyPrefix}-${contentKey}-${occurrence}`}
                className="flex items-center gap-2"
              >
                {todo.status === "completed" ? (
                  <CheckSquare className="h-4 w-4 text-green-500" />
                ) : todo.status === "in_progress" ? (
                  <Circle className="h-4 w-4 fill-yellow-500 text-yellow-500" />
                ) : (
                  <Square className="h-4 w-4 text-muted-foreground" />
                )}
                <span
                  className={cn(
                    "text-sm",
                    todo.status === "completed"
                      ? "text-muted-foreground line-through"
                      : todo.status === "in_progress"
                        ? "text-yellow-500"
                        : "text-foreground",
                  )}
                >
                  {todo.content}
                </span>
              </div>
            );
          });
        })()}
      </div>
    ) : undefined;

  return (
    <ToolLayout
      name="Todo list"
      summary={summary}
      meta={
        progressMeta ??
        (!activeTodoContent && metaParts.length > 0
          ? metaParts.join(" • ")
          : undefined)
      }
      state={state}
      expandedContent={expandedContent}
      defaultExpanded={false}
    />
  );
}
