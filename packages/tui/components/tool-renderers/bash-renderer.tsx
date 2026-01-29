import { TextAttributes } from "@opentui/core";
import React from "react";
import { PRIMARY_COLOR } from "../../lib/colors";
import type { ToolRendererProps } from "../../lib/render-tool";
import { getDotColor, ToolSpinner } from "./shared";

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
      ? PRIMARY_COLOR
      : isError
        ? "red"
        : getDotColor(state);

  return (
    <box flexDirection="column" marginTop={1} marginBottom={1}>
      <box flexDirection="row">
        {state.running ? <ToolSpinner /> : <text fg={dotColor}>● </text>}
        <text
          fg={state.denied ? "red" : "white"}
          attributes={TextAttributes.BOLD}
        >
          Bash
        </text>
        <text fg="gray">(</text>
        <text fg="white">
          {command.length > 60 ? command.slice(0, 60) + "…" : command || "..."}
        </text>
        <text fg="gray">)</text>
      </box>

      {/* Show Running/Waiting status for approval-requested tools */}
      {state.approvalRequested && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="gray">└ </text>
          <text fg="gray">
            {state.isActiveApproval ? "Running…" : "Waiting…"}
          </text>
        </box>
      )}

      {/* Show output when completed */}
      {part.state === "output-available" &&
        !state.approvalRequested &&
        !state.denied && (
          <box flexDirection="column" paddingLeft={2}>
            {isError && (
              <box flexDirection="row">
                <text fg="gray">└ </text>
                <text fg="red">Error: Exit code {exitCode}</text>
              </box>
            )}
            {hasOutput ? (
              <box flexDirection="column">
                {hasMoreLines && (
                  <box paddingLeft={isError ? 2 : 0} flexDirection="row">
                    <text fg="gray">└ </text>
                    <text fg="gray">...</text>
                  </box>
                )}
                {outputLines.map((line, i) => (
                  <box
                    key={i}
                    paddingLeft={isError ? 2 : 0}
                    flexDirection="row"
                  >
                    {!hasMoreLines && !isError && i === 0 && (
                      <text fg="gray">└ </text>
                    )}
                    {(hasMoreLines || isError || i > 0) && <text> </text>}
                    <text fg={isError ? "red" : "white"}>
                      {line.slice(0, 100)}
                    </text>
                  </box>
                ))}
              </box>
            ) : (
              !isError && (
                <box flexDirection="row">
                  <text fg="gray">└ </text>
                  <text fg="gray">(No content)</text>
                </box>
              )
            )}
          </box>
        )}

      {state.denied && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="gray">└ </text>
          <text fg="red">
            Denied{state.denialReason ? `: ${state.denialReason}` : ""}
          </text>
        </box>
      )}

      {state.error && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="gray">└ </text>
          <text fg="red">Error: {state.error.slice(0, 80)}</text>
        </box>
      )}
    </box>
  );
}
