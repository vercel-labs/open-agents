import * as path from "path";
import type { Sandbox } from "@open-agents/sandbox";
import { isPathWithinDirectory, shellEscape } from "./utils";

export function isDotEnvFilePath(filePath: string): boolean {
  const basename = path.basename(filePath.replaceAll("\\", "/")).toLowerCase();
  return basename.startsWith(".env");
}

export function resolveWorkspacePath(
  filePath: string,
  workingDirectory: string,
): string | null {
  const absolutePath = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(workingDirectory, filePath);

  return isPathWithinDirectory(absolutePath, workingDirectory)
    ? absolutePath
    : null;
}

export async function resolveSandboxRealPath(params: {
  sandbox: Sandbox;
  absolutePath: string;
  workingDirectory: string;
}): Promise<string | null> {
  if (typeof params.sandbox.exec !== "function") {
    return null;
  }

  const result = await params.sandbox.exec(
    `realpath -- ${shellEscape(params.absolutePath)}`,
    params.workingDirectory,
    5000,
  );

  if (!result.success) {
    return null;
  }

  const realPath = result.stdout.trim();
  if (!realPath) {
    return null;
  }

  return realPath;
}

export function isSensitiveDotEnvPath(params: {
  requestedPath: string;
  absolutePath: string;
  realPath?: string | null;
}): boolean {
  return (
    isDotEnvFilePath(params.requestedPath) ||
    isDotEnvFilePath(params.absolutePath) ||
    (params.realPath ? isDotEnvFilePath(params.realPath) : false)
  );
}
