import React from "react";
import { Box, Text } from "../ink-shim";

type HeaderProps = {
  name?: string;
  version?: string;
  model?: string;
  cwd?: string;
};

export function Header({ name, version, model, cwd }: HeaderProps) {
  const displayName = name?.trim() ? name : "AI SDK";
  const homedir = process.env.HOME || process.env.USERPROFILE || "";
  const displayCwd =
    cwd?.replace(homedir, "~") || process.cwd().replace(homedir, "~");

  return (
    <Box flexDirection="column" marginBottom={1} flexShrink={0}>
      {/* Info line */}
      <Box gap={1}>
        <Text bold>{displayName}</Text>
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
