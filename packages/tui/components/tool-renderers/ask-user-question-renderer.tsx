import { TextAttributes } from "@opentui/core";
import React from "react";
import { PRIMARY_COLOR } from "../../lib/colors";
import type { ToolRendererProps } from "../../lib/render-tool";
import { getDotColor, ToolSpinner } from "./shared";

type AskUserQuestionOutput =
  | { answers: Record<string, string | string[]> }
  | { declined: true };

function isAskUserQuestionOutput(
  value: unknown,
): value is AskUserQuestionOutput {
  if (typeof value !== "object" || value === null) return false;
  if ("declined" in value && value.declined === true) return true;
  if ("answers" in value && typeof value.answers === "object") return true;
  return false;
}

export function AskUserQuestionRenderer({
  part,
  state,
}: ToolRendererProps<"tool-ask_user_question">) {
  const questions = part.input?.questions ?? [];
  const questionCount = questions.length;

  // Extract output when available with proper runtime validation
  const output =
    part.state === "output-available" && isAskUserQuestionOutput(part.output)
      ? part.output
      : undefined;

  const isDeclined = output && "declined" in output && output.declined;
  const hasAnswers = output && "answers" in output;

  // Use primary dot when waiting for user input (like approval-requested tools)
  const isWaitingForInput = part.state === "input-available";
  const isGenerating = part.state === "input-streaming";
  const dotColor =
    state.denied || isDeclined
      ? "red"
      : isWaitingForInput
        ? PRIMARY_COLOR
        : getDotColor(state);

  return (
    <box flexDirection="column" marginTop={1} marginBottom={1}>
      <box flexDirection="row">
        {isGenerating ? <ToolSpinner /> : <text fg={dotColor}>● </text>}
        <text
          fg={state.denied || isDeclined ? "red" : "white"}
          attributes={TextAttributes.BOLD}
        >
          Ask User Question
        </text>
        <text fg="gray">(</text>
        <text fg="white">
          {questionCount} question{questionCount !== 1 ? "s" : ""}
        </text>
        <text fg="gray">)</text>
      </box>

      {/* Show generating status while streaming input */}
      {isGenerating && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="gray">└ </text>
          <text fg="gray">Generating questions...</text>
        </box>
      )}

      {/* Show waiting status when input is ready and awaiting user response */}
      {isWaitingForInput && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="gray">└ </text>
          <text fg="gray">Waiting for user input...</text>
        </box>
      )}

      {/* Show summary when output available and user answered */}
      {part.state === "output-available" &&
        hasAnswers &&
        !state.denied &&
        "answers" in output && (
          <box flexDirection="column" paddingLeft={2}>
            {questions.map((q, idx) => {
              if (!q || !q.question) return null;
              const answer = output.answers[q.question];
              const answerText = Array.isArray(answer)
                ? answer.join(", ")
                : answer;
              const isFirst = idx === 0;
              return (
                <box key={q.question} flexDirection="row">
                  <text fg="gray">{isFirst ? "└ " : "  "}</text>
                  <text fg="gray">· </text>
                  <text fg="white">{q.question}</text>
                  <text fg="gray"> → </text>
                  <text fg="green">{answerText ?? "No answer"}</text>
                </box>
              );
            })}
          </box>
        )}

      {/* Show declined message */}
      {part.state === "output-available" && isDeclined && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="gray">└ </text>
          <text fg="red">User declined to answer</text>
        </box>
      )}

      {state.denied && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="gray">└ </text>
          <text fg="red">Cancelled</text>
        </box>
      )}
    </box>
  );
}
