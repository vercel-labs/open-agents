"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolRendererProps } from "@/app/lib/render-tool";
import { ToolLayout } from "../tool-layout";

export function AskUserQuestionRenderer({
  part,
  state,
}: ToolRendererProps<"tool-ask_user_question">) {
  const input = part.input;
  const output = part.state === "output-available" ? part.output : undefined;
  const questions = input?.questions ?? [];

  const isWaitingForInput = part.state === "input-available";
  const isStreaming = part.state === "input-streaming";
  const hasOutput = part.state === "output-available";
  const isDeclined =
    hasOutput && output && "declined" in output && output.declined;
  const hasAnswers =
    hasOutput && output && "answers" in output && output.answers !== null;

  const dotColor = state.denied
    ? "bg-red-500"
    : isDeclined
      ? "bg-red-500"
      : isWaitingForInput
        ? "bg-yellow-500"
        : state.running
          ? "bg-yellow-500"
          : "bg-green-500";

  const indicator =
    state.running || isStreaming ? (
      <Loader2 className="h-3 w-3 animate-spin text-yellow-500" />
    ) : (
      <span className={cn("inline-block h-2 w-2 rounded-full", dotColor)} />
    );

  const summary = isStreaming
    ? "Generating questions"
    : isWaitingForInput
      ? "Waiting for user input"
      : isDeclined
        ? "User declined to answer"
        : hasAnswers
          ? "Answered"
          : state.denied
            ? "Cancelled"
            : "Questions";

  const questionCount = questions.length;
  const meta =
    questionCount > 0
      ? `${questionCount} question${questionCount === 1 ? "" : "s"}`
      : undefined;

  const expandedContent =
    hasAnswers && output && "answers" in output ? (
      <div className="space-y-2">
        {questions.map((q) => {
          if (!q?.question) return null;
          const questionKey = q.question;
          const answer = output.answers[questionKey];
          const answerStr = Array.isArray(answer)
            ? answer.join(", ")
            : (answer ?? "(not answered)");
          return (
            <div key={questionKey} className="space-y-0.5">
              <p className="text-sm text-foreground">{questionKey}</p>
              <p className="text-sm text-muted-foreground">
                <span className="text-green-500">&rarr;</span> {answerStr}
              </p>
            </div>
          );
        })}
      </div>
    ) : undefined;

  const displayState = isWaitingForInput
    ? { ...state, interrupted: false }
    : state;

  return (
    <ToolLayout
      name="Ask user"
      summary={summary}
      meta={meta}
      state={displayState}
      indicator={indicator}
      nameClassName={state.denied || isDeclined ? "text-red-500" : undefined}
      expandedContent={expandedContent}
      defaultExpanded={false}
    />
  );
}
