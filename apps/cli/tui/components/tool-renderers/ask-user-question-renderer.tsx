import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import React from "react";
import { PRIMARY_COLOR } from "../../lib/colors";
import type { ToolRendererProps } from "../../lib/render-tool";
import { truncateText } from "../../lib/truncate";
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
  const isInputReady = part.state !== "input-streaming";
  const questions = isInputReady ? (part.input?.questions ?? []) : [];
  const questionCount = questions.length;
  const questionCountLabel = isInputReady
    ? `${questionCount} question${questionCount !== 1 ? "s" : ""}`
    : "...";
  const { width } = useTerminalDimensions();
  const terminalWidth = width ?? 80;
  const linePrefixLength = "└ ".length + "· ".length;
  const separatorLength = " → ".length;
  const availableWidth = Math.max(
    10,
    terminalWidth - linePrefixLength - separatorLength,
  );
  const questionWidth = Math.max(10, Math.floor(availableWidth * 0.6));
  const answerWidth = Math.max(10, availableWidth - questionWidth);

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
        <text fg="gray"> · </text>
        <text fg="gray">{questionCountLabel}</text>
      </box>

      {/* Show waiting status when input is ready and awaiting user response */}
      {isWaitingForInput && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="gray">Waiting for input</text>
        </box>
      )}

      {/* Show summary when output available and user answered */}
      {part.state === "output-available" &&
        hasAnswers &&
        !state.denied &&
        "answers" in output && (
          <box flexDirection="column" paddingLeft={2}>
            {questions.map((q) => {
              if (!q || !q.question) return null;
              const answer = output.answers[q.question];
              const answerText = Array.isArray(answer)
                ? answer.join(", ")
                : answer;
              const displayQuestion = truncateText(q.question, questionWidth);
              const displayAnswer = truncateText(
                answerText ?? "No answer",
                answerWidth,
              );
              return (
                <box key={q.question} flexDirection="row">
                  <text fg="gray">· </text>
                  <text fg="white">{displayQuestion}</text>
                  <text fg="gray">: </text>
                  <text fg="green">{displayAnswer}</text>
                </box>
              );
            })}
          </box>
        )}

      {/* Show declined message */}
      {part.state === "output-available" && isDeclined && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="red">User declined to answer</text>
        </box>
      )}

      {state.denied && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="red">Cancelled</text>
        </box>
      )}
    </box>
  );
}
