"use client";

import { CheckSquare, Circle, Loader2, Square } from "lucide-react";
import React, { useState } from "react";
import type { ToolRenderState } from "@open-harness/shared/lib/tool-state";
import { cn } from "@/lib/utils";

type TodoItem = {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
};

type TodoInput = {
  todos?: TodoItem[];
};

export function TodoRenderer({
  part,
  state,
}: {
  part: {
    input?: unknown;
    state: string;
    output?: unknown;
    toolCallId?: string;
  };
  state: ToolRenderState;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const input = part.input as TodoInput | undefined;
  const todos = input?.todos ?? [];
  const keyPrefix = part.toolCallId ?? "todo";

  const completedCount = todos.filter((t) => t.status === "completed").length;
  const inProgressCount = todos.filter(
    (t) => t.status === "in_progress",
  ).length;
  const pendingCount = todos.filter((t) => t.status === "pending").length;

  const hasExpandableContent = todos.length > 0;

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

  const getSummary = () => {
    if (todos.length === 0) return "No tasks";
    const parts = [];
    if (completedCount > 0) parts.push(`${completedCount} done`);
    if (inProgressCount > 0) parts.push(`${inProgressCount} in progress`);
    if (pendingCount > 0) parts.push(`${pendingCount} pending`);
    return `${todos.length} tasks (${parts.join(", ")})`;
  };

  return (
    <div
      className={cn(
        "my-2 rounded-lg border border-border bg-card p-3",
        hasExpandableContent && "cursor-pointer hover:bg-accent/50",
      )}
      {...(hasExpandableContent && {
        onClick: handleClick,
        onKeyDown: handleKeyDown,
        role: "button",
        tabIndex: 0,
        "aria-expanded": isExpanded,
      })}
    >
      <div className="flex items-center gap-2">
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
        <span className="text-sm text-muted-foreground">({getSummary()})</span>
      </div>

      {/* Expanded full content */}
      {isExpanded && todos.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-border pt-3">
          {todos.map((todo, index) => (
            <div
              key={`${keyPrefix}-${index}`}
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
          ))}
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
