type SpawnStdin = ReturnType<typeof Bun.spawn>["stdin"];

async function writeToStdin(
  stdin: SpawnStdin | null,
  text: string,
): Promise<boolean> {
  if (!stdin || typeof stdin === "number") return false;
  await stdin.write(text);
  await stdin.end();
  return true;
}

async function copyWithCommand(cmd: string[], text: string): Promise<boolean> {
  try {
    const proc = Bun.spawn({
      cmd,
      stdin: "pipe",
      stdout: "ignore",
      stderr: "ignore",
    });

    const wrote = await writeToStdin(proc.stdin, text);
    if (!wrote) return false;

    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

async function copyTextMacOS(text: string): Promise<boolean> {
  return copyWithCommand(["pbcopy"], text);
}

async function copyTextLinux(text: string): Promise<boolean> {
  const wlCopyResult = await copyWithCommand(["wl-copy"], text);
  if (wlCopyResult) return true;
  return copyWithCommand(["xclip", "-selection", "clipboard"], text);
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (text.length === 0) return false;

  if (process.platform === "darwin") {
    return copyTextMacOS(text);
  }

  if (process.platform === "linux") {
    return copyTextLinux(text);
  }

  return false;
}
