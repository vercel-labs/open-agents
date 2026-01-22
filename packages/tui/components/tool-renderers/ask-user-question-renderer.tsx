import React from "react";
import { Box, Text } from "ink";
import type { ToolRendererProps } from "../../lib/render-tool";
import { ToolSpinner, getDotColor } from "./shared";

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

  // Use yellow dot when waiting for user input (like approval-requested tools)
  const isWaitingForInput = part.state === "input-available";
  const isGenerating = part.state === "input-streaming";
  const dotColor =
    state.denied || isDeclined
      ? "red"
      : isWaitingForInput
        ? "yellow"
        : getDotColor(state);

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box>
        {isGenerating ? <ToolSpinner /> : <Text color={dotColor}>● </Text>}
        <Text bold color={state.denied || isDeclined ? "red" : "white"}>
          Ask User Question
        </Text>
        <Text color="gray">(</Text>
        <Text color="white">
          {questionCount} question{questionCount !== 1 ? "s" : ""}
        </Text>
        <Text color="gray">)</Text>
      </Box>

      {/* Show generating status while streaming input */}
      {isGenerating && (
        <Box paddingLeft={2}>
          <Text color="gray">└ </Text>
          <Text color="gray">Generating questions...</Text>
        </Box>
      )}

      {/* Show waiting status when input is ready and awaiting user response */}
      {isWaitingForInput && (
        <Box paddingLeft={2}>
          <Text color="gray">└ </Text>
          <Text color="gray">Waiting for user input...</Text>
        </Box>
      )}

      {/* Show summary when output available and user answered */}
      {part.state === "output-available" &&
        hasAnswers &&
        !state.denied &&
        "answers" in output && (
          <Box flexDirection="column" paddingLeft={2}>
            {questions.map((q, idx) => {
              if (!q || !q.question) return null;
              const answer = output.answers[q.question];
              const answerText = Array.isArray(answer)
                ? answer.join(", ")
                : answer;
              const isFirst = idx === 0;
              return (
                <Box key={q.question}>
                  <Text color="gray">{isFirst ? "└ " : "  "}</Text>
                  <Text color="gray">· </Text>
                  <Text color="white">{q.question}</Text>
                  <Text color="gray"> → </Text>
                  <Text color="green">{answerText ?? "No answer"}</Text>
                </Box>
              );
            })}
          </Box>
        )}

      {/* Show declined message */}
      {part.state === "output-available" && isDeclined && (
        <Box paddingLeft={2}>
          <Text color="gray">└ </Text>
          <Text color="red">User declined to answer</Text>
        </Box>
      )}

      {state.denied && (
        <Box paddingLeft={2}>
          <Text color="gray">└ </Text>
          <Text color="red">Cancelled</Text>
        </Box>
      )}
    </Box>
  );
}
