"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import type { ToolRenderState } from "@open-harness/shared/lib/tool-state";
import { cn } from "@/lib/utils";
import type {
  AskUserQuestionInput,
  AskUserQuestionOutput,
} from "@open-harness/agent";

export function AskUserQuestionRenderer({
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
  const input = part.input as AskUserQuestionInput | undefined;
  const output = part.output as AskUserQuestionOutput | undefined;
  const questions = input?.questions ?? [];

  const isWaitingForInput = part.state === "input-available";
  const isStreaming = part.state === "input-streaming";
  const hasOutput = part.state === "output-available";
  const isDeclined =
    hasOutput && output && "declined" in output && output.declined;
  const hasAnswers =
    hasOutput && output && "answers" in output && output.answers !== null;

  const hasExpandableContent = questions.length > 0 && hasAnswers;

  const dotColor = state.denied
    ? "bg-red-500"
    : isDeclined
      ? "bg-red-500"
      : isWaitingForInput
        ? "bg-yellow-500"
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

  const getStatusText = () => {
    if (isStreaming) return "Generating questions...";
    if (isWaitingForInput)
      return `Waiting for user input (${questions.length} question${questions.length > 1 ? "s" : ""})`;
    if (isDeclined) return "User declined to answer";
    if (hasAnswers)
      return `Answered ${questions.length} question${questions.length > 1 ? "s" : ""}`;
    if (state.denied) return "Cancelled";
    return "Questions";
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
        {state.running || isStreaming ? (
          <Loader2 className="h-3 w-3 animate-spin text-yellow-500" />
        ) : (
          <span className={cn("inline-block h-2 w-2 rounded-full", dotColor)} />
        )}
        <span
          className={cn(
            "font-medium",
            state.denied || isDeclined ? "text-red-500" : "text-foreground",
          )}
        >
          Ask User
        </span>
        <span className="text-sm text-muted-foreground">
          ({getStatusText()})
        </span>
      </div>

      {/* Show Q&A when expanded and answered */}
      {isExpanded && hasAnswers && output && "answers" in output && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          {questions.map((q) => {
            const answer = output.answers[q.question];
            const answerStr = Array.isArray(answer)
              ? answer.join(", ")
              : (answer ?? "(not answered)");
            return (
              <div key={q.question} className="space-y-0.5">
                <p className="text-sm text-foreground">{q.question}</p>
                <p className="text-sm text-muted-foreground">
                  <span className="text-green-500">&rarr;</span> {answerStr}
                </p>
              </div>
            );
          })}
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
