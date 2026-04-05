"use client";

import { MessageCircleQuestion } from "lucide-react";
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
      icon={<MessageCircleQuestion className="h-3.5 w-3.5" />}
      nameClassName={state.denied || isDeclined ? "text-red-500" : undefined}
      expandedContent={expandedContent}
      defaultExpanded={false}
    />
  );
}
