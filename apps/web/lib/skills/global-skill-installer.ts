import "server-only";

import type { Sandbox } from "@open-agents/sandbox";
import {
  type GlobalSkillRef,
  globalSkillRefsSchema,
} from "@/lib/skills/global-skill-refs";
import {
  resolveSandboxHomeDirectory,
  shellEscape,
} from "@/lib/sandbox/home-directory";

const GLOBAL_SKILLS_INSTALL_TIMEOUT_MS = 120_000;

export async function installGlobalSkills(params: {
  sandbox: Sandbox;
  globalSkillRefs: GlobalSkillRef[];
}): Promise<void> {
  const globalSkillRefs = globalSkillRefsSchema.parse(params.globalSkillRefs);
  if (globalSkillRefs.length === 0) {
    return;
  }

  const homeDirectory = await resolveSandboxHomeDirectory(params.sandbox);

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
}
