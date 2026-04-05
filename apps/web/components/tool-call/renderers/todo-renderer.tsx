"use client";

import {
  CheckCircle2,
  Circle,
  LayoutList,
  ListChecks,
  ListTodo,
  Loader2,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ToolRendererProps } from "@/app/lib/render-tool";
import { ToolLayout } from "../tool-layout";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Todo = Record<string, any>;

function TodoItem({ todo }: { todo: Todo }) {
  const status = todo.status ?? "pending";
  const content = todo.content ?? "";

  return (
    <div className="flex items-start gap-2 py-0.5">
      <span className="mt-0.5 flex shrink-0 items-center">
        {status === "completed" ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
        ) : status === "in_progress" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-yellow-500" />
        ) : (
          <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />
        )}
      </span>
      <span
        className={cn(
          "text-xs leading-relaxed",
          status === "completed"
            ? "text-muted-foreground line-through"
            : status === "in_progress"
              ? "text-foreground"
              : "text-muted-foreground",
        )}
      >
        {content}
      </span>
    </div>
  );
}

export function TodoRenderer({
  part,
  state,
}: ToolRendererProps<"tool-todo_write">) {
  const input = part.input;
  const todos: Todo[] = (input?.todos ?? []).filter(
    (t): t is Todo => t !== undefined,
  );

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

  const expandedContent =
    todos.length > 0 ? (
      <div className="space-y-0.5 pl-1">
        {todos.map((todo, i) => (
          <TodoItem key={todo.id ?? i} todo={todo} />
        ))}
      </div>
    ) : undefined;

  return (
    <ToolLayout
      name={name}
      icon={icon}
      summary={summary}
      state={state}
      expandedContent={expandedContent}
      defaultExpanded={!allDone}
    />
  );
}
