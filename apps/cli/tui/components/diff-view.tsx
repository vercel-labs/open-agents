import { TextAttributes } from "@opentui/core";
import React from "react";

type DiffLine = {
  type: "context" | "addition" | "removal";
  lineNumber: number;
  content: string;
};

type DiffViewProps = {
  filePath: string;
  additions: number;
  removals: number;
  lines: DiffLine[];
  maxLines?: number;
};

export function DiffView({
  filePath,
  additions,
  removals,
  lines,
  maxLines = 10,
}: DiffViewProps) {
  const displayLines = lines.slice(0, maxLines);

  return (
    <box flexDirection="column" marginLeft={2}>
      {/* Header */}
      <box>
        <text fg="gray">└ Updated </text>
        <text attributes={TextAttributes.BOLD}>{filePath}</text>
        <text fg="gray"> with </text>
        <text fg="green">
          {additions} addition{additions !== 1 ? "s" : ""}
        </text>
        <text fg="gray"> and </text>
        <text fg="red">
          {removals} removal{removals !== 1 ? "s" : ""}
        </text>
      </box>

      {/* Diff lines */}
      <box flexDirection="column" marginLeft={2}>
        {displayLines.map((line, i) => (
          <box key={i}>
            {/* Line number */}
            <text fg="gray">{String(line.lineNumber).padStart(3, " ")} </text>

            {/* +/- indicator and content */}
            {line.type === "addition" ? (
              <>
                <text fg="green" bg="brightGreen">
                  +{" "}
                </text>
                <text fg="white" bg="green">
                  {line.content}
                </text>
              </>
            ) : line.type === "removal" ? (
              <>
                <text fg="red" bg="brightRed">
                  -{" "}
                </text>
                <text fg="white" bg="red">
                  {line.content}
                </text>
              </>
            ) : (
              <>
                <text fg="gray"> </text>
                <text>{line.content}</text>
              </>
            )}
          </box>
        ))}
      </box>
    </box>
  );
}

// Helper to parse edit tool output into diff lines
export function parseEditOutput(
  oldString: string,
  newString: string,
  startLine: number = 1,
): DiffLine[] {
  const oldLines = oldString.split("\n");
  const newLines = newString.split("\n");
  const result: DiffLine[] = [];

  let lineNum = startLine;

  // Simple diff - show removals then additions
  for (const line of oldLines) {
    result.push({ type: "removal", lineNumber: lineNum, content: line });
    lineNum++;
  }

  lineNum = startLine;
  for (const line of newLines) {
    result.push({ type: "addition", lineNumber: lineNum, content: line });
    lineNum++;
  }

  return result;
}
