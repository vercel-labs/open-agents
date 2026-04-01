import "server-only";

import type { Sandbox } from "@open-harness/sandbox";
import { z } from "zod";
import { shellEscape, resolveSandboxHomeDirectory } from "@/lib/sandbox/home-directory";
import {
  areGlobalSkillRefsEqual,
  globalSkillRefsSchema,
  type GlobalSkillRef,
} from "./global-skill-refs";
import {
  getGlobalSkillsManifestDirectory,
  getGlobalSkillsManifestPath,
} from "./directories";

const GLOBAL_SKILLS_MANIFEST_VERSION = 1;
const FILESYSTEM_TIMEOUT_MS = 5_000;
const GLOBAL_SKILLS_INSTALL_TIMEOUT_MS = 120_000;

const globalSkillsManifestSchema = z.object({
  version: z.literal(GLOBAL_SKILLS_MANIFEST_VERSION),
  globalSkillRefs: globalSkillRefsSchema,
});

async function ensureDirectoryExists(
  sandbox: Sandbox,
  directoryPath: string,
): Promise<void> {
  const result = await sandbox.exec(
    `mkdir -p ${shellEscape(directoryPath)}`,
    sandbox.workingDirectory,
    FILESYSTEM_TIMEOUT_MS,
  );

  if (!result.success) {
    throw new Error(
      `Failed to create directory ${directoryPath}: ${result.stderr || result.stdout || "unknown error"}`,
    );
  }
}

async function readInstalledGlobalSkillRefs(
  sandbox: Sandbox,
  manifestPath: string,
): Promise<GlobalSkillRef[] | null> {
  try {
    const manifestContent = await sandbox.readFile(manifestPath, "utf-8");
    const manifestJson = JSON.parse(manifestContent) as unknown;
    const parsedManifest = globalSkillsManifestSchema.safeParse(manifestJson);
    return parsedManifest.success ? parsedManifest.data.globalSkillRefs : null;
  } catch {
    return null;
  }
}

export async function installGlobalSkills(params: {
  sandbox: Sandbox;
  sessionId: string;
  globalSkillRefs: GlobalSkillRef[];
}): Promise<void> {
  const globalSkillRefs = globalSkillRefsSchema.parse(params.globalSkillRefs);
  if (globalSkillRefs.length === 0) {
    return;
  }

  const homeDirectory = await resolveSandboxHomeDirectory(params.sandbox);
  const manifestPath = getGlobalSkillsManifestPath(homeDirectory, params.sessionId);
  const installedGlobalSkillRefs = await readInstalledGlobalSkillRefs(
    params.sandbox,
    manifestPath,
  );

  if (
    installedGlobalSkillRefs !== null &&
    areGlobalSkillRefsEqual(installedGlobalSkillRefs, globalSkillRefs)
  ) {
    return;
  }

  await ensureDirectoryExists(
    params.sandbox,
    getGlobalSkillsManifestDirectory(homeDirectory),
  );

  for (const globalSkillRef of globalSkillRefs) {
    const result = await params.sandbox.exec(
      `HOME=${shellEscape(homeDirectory)} npx skills add ${shellEscape(globalSkillRef.source)} --skill ${shellEscape(globalSkillRef.skillName)} --agent amp -g -y --copy`,
      params.sandbox.workingDirectory,
      GLOBAL_SKILLS_INSTALL_TIMEOUT_MS,
    );

    if (!result.success) {
      throw new Error(
        `Failed to install global skill ${globalSkillRef.skillName} from ${globalSkillRef.source}: ${result.stderr || result.stdout || "unknown error"}`,
      );
    }
  }

  await params.sandbox.writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        version: GLOBAL_SKILLS_MANIFEST_VERSION,
        globalSkillRefs,
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
}
