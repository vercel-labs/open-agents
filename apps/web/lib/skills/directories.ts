import "server-only";

import path from "node:path";
import type { Sandbox } from "@open-harness/sandbox";
import { resolveSandboxHomeDirectory } from "@/lib/sandbox/home-directory";

const PROJECT_SKILL_BASE_FOLDERS = [".claude", ".agents"];
const GLOBAL_SKILLS_RELATIVE_DIRECTORY = ".agents/skills";
const GLOBAL_SKILLS_MANIFEST_RELATIVE_DIRECTORY = ".open-harness/global-skills";

export function getProjectSkillDirectories(workingDirectory: string): string[] {
  return PROJECT_SKILL_BASE_FOLDERS.map((folder) =>
    path.posix.join(workingDirectory, folder, "skills"),
  );
}

export function getGlobalSkillsDirectory(homeDirectory: string): string {
  return path.posix.join(homeDirectory, GLOBAL_SKILLS_RELATIVE_DIRECTORY);
}

export function getGlobalSkillsManifestDirectory(homeDirectory: string): string {
  return path.posix.join(
    homeDirectory,
    GLOBAL_SKILLS_MANIFEST_RELATIVE_DIRECTORY,
  );
}

export function getGlobalSkillsManifestPath(
  homeDirectory: string,
  sessionId: string,
): string {
  return path.posix.join(
    getGlobalSkillsManifestDirectory(homeDirectory),
    `${sessionId}.json`,
  );
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
