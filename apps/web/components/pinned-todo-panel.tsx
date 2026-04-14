"use client";

import { ArrowRight, ChevronDown, ChevronRight } from "lucide-react";
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
 * Extract the latest committed todo list from the conversation.
 * Ignores still-streaming todo tool inputs so the pinned panel only swaps once
 * a full update is available.
 */
export function getLatestTodos(messages: WebAgentUIMessage[]): TodoItem[] {
  let latestTodos: TodoItem[] = [];

  for (const message of messages) {
    for (const part of message.parts) {
      if (!isToolUIPart(part) || part.type !== "tool-todo_write") {
        continue;
      }

      if (part.state === "input-streaming") {
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

/** In-progress: filled circle with arrow-right icon inside */
function InProgressIcon({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex h-4 w-4 items-center justify-center",
        className,
      )}
    >
      {/* Filled circle background */}
      <svg
        viewBox="0 0 16 16"
        fill="none"
        className="absolute inset-0 h-4 w-4"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="7.25" fill="currentColor" />
      </svg>
      {/* Arrow icon on top, colored to contrast */}
      <ArrowRight className="relative h-2.5 w-2.5 text-muted" strokeWidth={3} />
    </span>
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

  const completedCount = todos.filter((t) => t.status === "completed").length;
  const totalCount = todos.length;
  const allDone = completedCount === totalCount && totalCount > 0;
  const hasActiveWork = todos.some(
    (t) => t.status === "in_progress" || t.status === "pending",
  );

  // Hide when: no todos, all done, or no work started yet (all pending, agent still building list)
  if (totalCount === 0 || allDone || !hasActiveWork) return null;

  // Find the active task name for the minimized summary
  const activeTask = todos.find((t) => t.status === "in_progress");

  return (
    <div className="mx-4 overflow-hidden rounded-t-xl border border-b-0 border-border/60 bg-card transition-all">
      {/* Header bar — always visible */}
      <button
        type="button"
        onClick={() => setIsMinimized((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted-foreground/5"
      >
        {/* Chevron on the left */}
        {isMinimized ? (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
        )}
        {/* Counter + label — always visible */}
        <span className="shrink-0 text-xs font-semibold text-muted-foreground/70">
          {completedCount}/{totalCount} Tasks
        </span>
        {/* Active task name — only when minimized */}
        {isMinimized && activeTask?.content && (
          <span className="min-w-0 flex-1 truncate font-mono text-xs font-normal text-muted-foreground/50">
            {activeTask.content}
          </span>
        )}
      </button>

      {/* Expanded todo list */}
      {!isMinimized && (
        <div className="max-h-48 overflow-y-auto border-t border-border/40 px-3 py-2">
          <div className="space-y-1">
            {todos.map((todo, index) => {
              if (!todo) return null;
              return (
                <div
                  key={`pinned-todo-${todo.id ?? index}`}
                  className="flex items-center gap-2.5"
                >
                  <span className="shrink-0">
                    {todo.status === "completed" ? (
                      <CompletedIcon className="text-muted-foreground/50" />
                    ) : todo.status === "in_progress" ? (
                      <InProgressIcon className="text-muted-foreground/50" />
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
