import { TextAttributes } from "@opentui/core";
import React from "react";

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
    <box flexDirection="column" marginBottom={1} flexShrink={0}>
      {/* Info line */}
      <box gap={1} flexDirection="row">
        <text attributes={TextAttributes.BOLD}>{displayName}</text>
        {version && <text attributes={TextAttributes.DIM}>v{version}</text>}
        {model && (
          <>
            <text attributes={TextAttributes.DIM}>·</text>
            <text attributes={TextAttributes.DIM}>{model}</text>
          </>
        )}
      </box>

      {/* Working directory */}
      <box flexDirection="row">
        <text attributes={TextAttributes.DIM}>{displayCwd}</text>
      </box>
    </box>
  );
}
