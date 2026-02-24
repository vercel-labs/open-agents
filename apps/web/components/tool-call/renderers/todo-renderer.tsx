"use client";

import { CheckSquare, Circle, Loader2, Square } from "lucide-react";
import React, { useState } from "react";
import type { ToolRendererProps } from "@/app/lib/render-tool";
import { cn } from "@/lib/utils";

type TodoStatus = "pending" | "in_progress" | "completed";

type TodoItem = {
  id?: string;
  content?: string;
  status?: TodoStatus;
};

const MAX_VISIBLE_TODOS = 8;

export function TodoRenderer({
  part,
  state,
}: ToolRendererProps<"tool-todo_write">) {
  const [isExpanded, setIsExpanded] = useState(true);
  const input = part.input;
  const todos = Array.isArray(input?.todos) ? (input.todos as TodoItem[]) : [];
  const keyPrefix = part.toolCallId ?? "todo";

  const hasExpandableContent = todos.length > 0;

  const visibleTodos =
    todos.length > MAX_VISIBLE_TODOS ? todos.slice(-MAX_VISIBLE_TODOS) : todos;
  const hiddenCount = Math.max(0, todos.length - visibleTodos.length);

  const dotColor = state.denied
    ? "bg-red-500"
    : state.running
      ? "bg-yellow-500"
      : "bg-green-500";

  const handleClick = () => {
    if (hasExpandableContent) {
      setIsExpanded(!isExpanded);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (hasExpandableContent) {
        setIsExpanded(!isExpanded);
      }
    }
  };

  return (
    <div className="my-2 rounded-lg border border-border bg-card p-3">
      <div
        className={cn(
          "flex items-center gap-2",
          hasExpandableContent && "cursor-pointer",
        )}
        {...(hasExpandableContent && {
          onClick: handleClick,
          onKeyDown: handleKeyDown,
          role: "button",
          tabIndex: 0,
          "aria-expanded": isExpanded,
        })}
      >
        {state.running ? (
          <Loader2 className="h-3 w-3 animate-spin text-yellow-500" />
        ) : (
          <span className={cn("inline-block h-2 w-2 rounded-full", dotColor)} />
        )}
        <span
          className={cn(
            "font-medium",
            state.denied ? "text-red-500" : "text-foreground",
          )}
        >
          Todo List
        </span>
      </div>

      {isExpanded && visibleTodos.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-border pt-3">
          {hiddenCount > 0 && (
            <div className="text-xs text-muted-foreground">
              Showing latest {visibleTodos.length} items ({hiddenCount} older
              items truncated)
            </div>
          )}

          {(() => {
            const todoContentCounts = new Map<string, number>();
            return visibleTodos.map((todo, index) => {
              if (!todo) return null;

              const content =
                typeof todo.content === "string" && todo.content.length > 0
                  ? todo.content
                  : "(empty task)";
              const contentKey = content;
              const occurrence = todoContentCounts.get(contentKey) ?? 0;
              todoContentCounts.set(contentKey, occurrence + 1);

              const itemKey =
                typeof todo.id === "string" && todo.id.length > 0
                  ? `${keyPrefix}-${todo.id}`
                  : `${keyPrefix}-${contentKey}-${hiddenCount + index}-${occurrence}`;

              return (
                <div key={itemKey} className="flex min-w-0 items-center gap-2">
                  {todo.status === "completed" ? (
                    <CheckSquare className="h-4 w-4 shrink-0 text-green-500" />
                  ) : todo.status === "in_progress" ? (
                    <Circle className="h-4 w-4 shrink-0 fill-yellow-500 text-yellow-500" />
                  ) : (
                    <Square className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span
                    className={cn(
                      "truncate text-sm",
                      todo.status === "completed"
                        ? "text-muted-foreground line-through"
                        : todo.status === "in_progress"
                          ? "text-yellow-500"
                          : "text-foreground",
                    )}
                    title={content}
                  >
                    {content}
                  </span>
                </div>
              );
            });
          })()}
        </div>
      )}

      {state.denied && (
        <div className="mt-2 pl-5 text-sm text-red-500">
          Denied{state.denialReason ? `: ${state.denialReason}` : ""}
        </div>
      )}

      {state.error && !state.denied && (
        <div className="mt-2 pl-5 text-sm text-red-500">
          Error: {state.error.slice(0, 80)}
        </div>
      )}
    </div>
  );
}
