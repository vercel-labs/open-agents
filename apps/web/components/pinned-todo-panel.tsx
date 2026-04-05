"use client";

import {
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Circle,
  ListTodo,
  Square,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { isToolUIPart } from "ai";
import type { WebAgentUIMessage } from "@/app/types";

export type TodoItem = {
  id?: string;
  content?: string;
  status?: string;
};

/**
 * Extract the latest todo list from all messages across the entire conversation.
 * Looks at every message for tool-todo_write parts and returns the most recent one.
 */
export function getLatestTodos(messages: WebAgentUIMessage[]): TodoItem[] {
  let latestTodos: TodoItem[] = [];

  for (const message of messages) {
    for (const part of message.parts) {
      if (!isToolUIPart(part) || part.type !== "tool-todo_write") {
        continue;
      }
      const input = part.input as { todos?: TodoItem[] } | undefined;
      const todos = input?.todos;
      if (Array.isArray(todos) && todos.length > 0) {
        latestTodos = todos;
      }
    }
  }

  return latestTodos;
}

export type PinnedTodoPanelProps = {
  todos: TodoItem[];
};

export function PinnedTodoPanel({ todos }: PinnedTodoPanelProps) {
  const [isMinimized, setIsMinimized] = useState(false);

  if (todos.length === 0) return null;

  const completedCount = todos.filter((t) => t.status === "completed").length;
  const inProgressCount = todos.filter(
    (t) => t.status === "in_progress",
  ).length;
  const pendingCount = todos.filter((t) => t.status === "pending").length;
  const totalCount = todos.length;
  const progressPercent =
    totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  const allDone = completedCount === totalCount;

  return (
    <div className="mx-auto w-full max-w-4xl px-4">
      <div
        className={cn(
          "overflow-hidden rounded-xl border bg-card shadow-sm transition-all",
          allDone ? "border-green-500/30" : "border-border",
        )}
      >
        {/* Header - always visible, clickable to toggle */}
        <button
          type="button"
          onClick={() => setIsMinimized((v) => !v)}
          className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50"
        >
          <ListTodo className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="text-sm font-medium">Tasks</span>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {completedCount}/{totalCount}
            </span>
            {/* Progress bar */}
            <div className="hidden h-1.5 flex-1 overflow-hidden rounded-full bg-muted sm:block">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  allDone ? "bg-green-500" : "bg-primary",
                )}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {/* Status badges */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {inProgressCount > 0 && (
                <span className="flex items-center gap-1 text-yellow-500">
                  <Circle className="h-2.5 w-2.5 fill-current" />
                  {inProgressCount}
                </span>
              )}
              {pendingCount > 0 && (
                <span className="flex items-center gap-1">
                  <Square className="h-2.5 w-2.5" />
                  {pendingCount}
                </span>
              )}
              {completedCount > 0 && (
                <span className="flex items-center gap-1 text-green-500">
                  <CheckSquare className="h-2.5 w-2.5" />
                  {completedCount}
                </span>
              )}
            </div>
          </div>
          {isMinimized ? (
            <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
        </button>

        {/* Todo items - collapsible */}
        {!isMinimized && (
          <div className="border-t px-4 py-2.5">
            <div className="space-y-1.5">
              {todos.map((todo, index) => {
                if (!todo) return null;
                return (
                  <div
                    key={`pinned-todo-${todo.id ?? index}`}
                    className="flex items-start gap-2.5"
                  >
                    <span className="mt-0.5 shrink-0">
                      {todo.status === "completed" ? (
                        <CheckSquare className="h-4 w-4 text-green-500" />
                      ) : todo.status === "in_progress" ? (
                        <Circle className="h-4 w-4 fill-yellow-500 text-yellow-500" />
                      ) : (
                        <Square className="h-4 w-4 text-muted-foreground" />
                      )}
                    </span>
                    <span
                      className={cn(
                        "text-sm leading-relaxed",
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
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
