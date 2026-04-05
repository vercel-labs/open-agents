"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
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

/** Completed: check inside a circle */
function CompletedIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      className={cn("h-4 w-4", className)}
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M5 8.5L7 10.5L11 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** In-progress: filled circle with right arrow */
function InProgressIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      className={cn("h-4 w-4", className)}
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.15" />
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M6.5 5L10.5 8L6.5 11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Pending: dashed circle */
function PendingIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      className={cn("h-4 w-4", className)}
      aria-hidden="true"
    >
      <circle
        cx="8"
        cy="8"
        r="7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="3.5 2.5"
      />
    </svg>
  );
}

export type PinnedTodoPanelProps = {
  todos: TodoItem[];
};

export function PinnedTodoPanel({ todos }: PinnedTodoPanelProps) {
  const [isMinimized, setIsMinimized] = useState(false);

  if (todos.length === 0) return null;

  const completedCount = todos.filter((t) => t.status === "completed").length;
  const totalCount = todos.length;

  // Find the active task name for the minimized summary
  const activeTask = todos.find((t) => t.status === "in_progress");
  const summaryText = activeTask?.content
    ? activeTask.content
    : `${completedCount} of ${totalCount} tasks done`;

  return (
    <div className="transition-all">
      {/* Header bar — always visible */}
      <button
        type="button"
        onClick={() => setIsMinimized((v) => !v)}
        className="flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-muted-foreground/5"
      >
        <span className="text-xs font-medium text-muted-foreground/70">
          {completedCount}/{totalCount}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground/70">
          {isMinimized ? summaryText : "Tasks"}
        </span>
        {isMinimized ? (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground/50" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/50" />
        )}
      </button>

      {/* Expanded todo list */}
      {!isMinimized && (
        <div className="px-4 pb-2">
          <div className="space-y-1">
            {todos.map((todo, index) => {
              if (!todo) return null;
              return (
                <div
                  key={`pinned-todo-${todo.id ?? index}`}
                  className="flex items-start gap-2.5"
                >
                  <span className="mt-px shrink-0">
                    {todo.status === "completed" ? (
                      <CompletedIcon className="text-muted-foreground/50" />
                    ) : todo.status === "in_progress" ? (
                      <InProgressIcon className="text-muted-foreground" />
                    ) : (
                      <PendingIcon className="text-muted-foreground/30" />
                    )}
                  </span>
                  <span
                    className={cn(
                      "text-sm leading-normal",
                      todo.status === "completed"
                        ? "text-muted-foreground/40 line-through"
                        : todo.status === "in_progress"
                          ? "text-muted-foreground"
                          : "text-muted-foreground/50",
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
  );
}
