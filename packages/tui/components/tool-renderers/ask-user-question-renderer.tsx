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

  const dotColor = state.denied || isDeclined ? "red" : getDotColor(state);

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box>
        {state.running ? <ToolSpinner /> : <Text color={dotColor}>● </Text>}
        <Text bold color={state.denied || isDeclined ? "red" : "white"}>
          Ask User Question
        </Text>
        <Text color="gray">(</Text>
        <Text color="white">
          {questionCount} question{questionCount !== 1 ? "s" : ""}
        </Text>
        <Text color="gray">)</Text>
      </Box>

      {/* Show waiting status when input available but not yet answered */}
      {(part.state === "input-available" ||
        part.state === "input-streaming") && (
        <Box paddingLeft={2}>
          <Text color="gray">└ </Text>
          <Text color="gray">Waiting for user input...</Text>
        </Box>
      )}

      {/* Show summary when output available and user answered */}
      {part.state === "output-available" && hasAnswers && !state.denied && (
        <Box paddingLeft={2}>
          <Text color="gray">└ </Text>
          <Text color="green">User answered questions</Text>
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
