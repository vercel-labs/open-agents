import "server-only";

import path from "node:path";
import type { Sandbox } from "@open-agents/sandbox";
import { resolveSandboxHomeDirectory } from "@/lib/sandbox/home-directory";

const PROJECT_SKILL_BASE_FOLDERS = [".claude", ".agents"];

export function getProjectSkillDirectories(workingDirectory: string): string[] {
  return PROJECT_SKILL_BASE_FOLDERS.map((folder) =>
    path.posix.join(workingDirectory, folder, "skills"),
  );
}

export function getGlobalSkillsDirectory(homeDirectory: string): string {
  return path.posix.join(homeDirectory, ".agents", "skills");
}

export async function getSandboxSkillDirectories(
  sandbox: Sandbox,
): Promise<string[]> {
  const homeDirectory = await resolveSandboxHomeDirectory(sandbox);

  return [
    ...getProjectSkillDirectories(sandbox.workingDirectory),
    getGlobalSkillsDirectory(homeDirectory),
  ];
}
