import React from "react";
import { Box, Text } from "ink";
import type { ToolRendererProps } from "../../lib/render-tool.js";
import { ToolSpinner, getDotColor } from "./shared.js";

export function BashRenderer({ part, state }: ToolRendererProps<"tool-bash">) {
  const command = String(part.input?.command ?? "");
  const exitCode =
    part.state === "output-available" ? part.output?.exitCode : undefined;
  const stdout =
    part.state === "output-available" ? part.output?.stdout : undefined;
  const stderr =
    part.state === "output-available" ? part.output?.stderr : undefined;
  const hasOutput = stdout || stderr;
  const isError = exitCode !== undefined && exitCode !== 0;

  // Combine stdout and stderr, show last 3 lines
  const combinedOutput = [stdout, stderr].filter(Boolean).join("\n").trim();
  const allLines = combinedOutput.split("\n");
  const outputLines = allLines.slice(-3); // Last 3 lines
  const hasMoreLines = allLines.length > 3;

  const dotColor = state.denied
    ? "red"
    : state.approvalRequested
      ? "yellow"
      : isError
        ? "red"
        : getDotColor(state);

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box>
        {state.running ? <ToolSpinner /> : <Text color={dotColor}>● </Text>}
        <Text bold color={state.denied ? "red" : "white"}>
          Bash
        </Text>
        <Text color="gray">(</Text>
        <Text color="white">
          {command.length > 60 ? command.slice(0, 60) + "…" : command || "..."}
        </Text>
        <Text color="gray">)</Text>
      </Box>

      {/* Show Running/Waiting status for approval-requested tools */}
      {state.approvalRequested && (
        <Box paddingLeft={2}>
          <Text color="gray">└ </Text>
          <Text color="gray">
            {state.isActiveApproval ? "Running…" : "Waiting…"}
          </Text>
        </Box>
      )}

      {/* Show output when completed */}
      {part.state === "output-available" &&
        !state.approvalRequested &&
        !state.denied && (
          <Box flexDirection="column" paddingLeft={2}>
            {isError && (
              <Box>
                <Text color="gray">└ </Text>
                <Text color="red">Error: Exit code {exitCode}</Text>
              </Box>
            )}
            {hasOutput ? (
              <Box flexDirection="column">
                {hasMoreLines && (
                  <Box paddingLeft={isError ? 2 : 0}>
                    <Text color="gray">└ </Text>
                    <Text color="gray">...</Text>
                  </Box>
                )}
                {outputLines.map((line, i) => (
                  <Box key={i} paddingLeft={isError ? 2 : 0}>
                    {!hasMoreLines && !isError && i === 0 && (
                      <Text color="gray">└ </Text>
                    )}
                    {(hasMoreLines || isError || i > 0) && <Text> </Text>}
                    <Text color={isError ? "red" : "white"}>
                      {line.slice(0, 100)}
                    </Text>
                  </Box>
                ))}
              </Box>
            ) : (
              !isError && (
                <Box>
                  <Text color="gray">└ </Text>
                  <Text color="gray">(No content)</Text>
                </Box>
              )
            )}
          </Box>
        )}

      {state.denied && (
        <Box paddingLeft={2}>
          <Text color="gray">└ </Text>
          <Text color="red">
            Denied{state.denialReason ? `: ${state.denialReason}` : ""}
          </Text>
        </Box>
      )}

      {state.error && (
        <Box paddingLeft={2}>
          <Text color="gray">└ </Text>
          <Text color="red">Error: {state.error.slice(0, 80)}</Text>
        </Box>
      )}
    </Box>
  );
}
