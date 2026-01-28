import React from "react";
import { Box, Text } from "../ink-shim";
import { MarkdownContent } from "../lib/markdown";

type TextOutputProps = {
  text: string;
  reasoning?: string;
  showReasoning?: boolean;
};

export function TextOutput({
  text,
  reasoning,
  showReasoning = false,
}: TextOutputProps) {
  return (
    <Box flexDirection="column">
      {showReasoning && reasoning && (
        <Box marginBottom={1}>
          <Text color="blue" dimColor>
            {" "}
            {reasoning}
          </Text>
        </Box>
      )}
      {text && (
        <Box>
          <Text color="white">● </Text>
          <Box flexShrink={1} flexGrow={1}>
            <MarkdownContent content={text} />
          </Box>
        </Box>
      )}
    </Box>
  );
}
