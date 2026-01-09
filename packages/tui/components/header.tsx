import React from "react";
import { Box, Text } from "ink";

type HeaderProps = {
  name?: string;
  version?: string;
  model?: string;
  cwd?: string;
};

export function Header({ name = "AI SDK", version, model, cwd }: HeaderProps) {
  const homedir = process.env.HOME || process.env.USERPROFILE || "";
  const displayCwd =
    cwd?.replace(homedir, "~") || process.cwd().replace(homedir, "~");

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Info line */}
      <Box gap={1}>
        <Text bold>{name}</Text>
        {version && <Text dimColor>v{version}</Text>}
        {model && (
          <>
            <Text dimColor>·</Text>
            <Text dimColor>{model}</Text>
          </>
        )}
      </Box>

      {/* Working directory */}
      <Box>
        <Text dimColor>{displayCwd}</Text>
      </Box>
    </Box>
  );
}
