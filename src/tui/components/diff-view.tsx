import React from "react";
import { Box, Text } from "ink";

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
    <Box flexDirection="column" marginLeft={2}>
      {/* Header */}
      <Box>
        <Text color="gray">└ Updated </Text>
        <Text bold>{filePath}</Text>
        <Text color="gray"> with </Text>
        <Text color="green">
          {additions} addition{additions !== 1 ? "s" : ""}
        </Text>
        <Text color="gray"> and </Text>
        <Text color="red">
          {removals} removal{removals !== 1 ? "s" : ""}
        </Text>
      </Box>

      {/* Diff lines */}
      <Box flexDirection="column" marginLeft={2}>
        {displayLines.map((line, i) => (
          <Box key={i}>
            {/* Line number */}
            <Text color="gray">
              {String(line.lineNumber).padStart(3, " ")}{" "}
            </Text>

            {/* +/- indicator and content */}
            {line.type === "addition" ? (
              <>
                <Text color="green" backgroundColor="greenBright">
                  +{" "}
                </Text>
                <Text color="white" backgroundColor="green">
                  {line.content}
                </Text>
              </>
            ) : line.type === "removal" ? (
              <>
                <Text color="red" backgroundColor="redBright">
                  -{" "}
                </Text>
                <Text color="white" backgroundColor="red">
                  {line.content}
                </Text>
              </>
            ) : (
              <>
                <Text color="gray"> </Text>
                <Text>{line.content}</Text>
              </>
            )}
          </Box>
        ))}
      </Box>
    </Box>
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
