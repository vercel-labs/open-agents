import "server-only";
import type { Sandbox } from "@open-harness/sandbox";

export interface VercelCliSandboxSetup {
  projectLink: null;
}

interface SessionVercelCliContext {
  vercelProjectId: string | null;
  vercelProjectName: string | null;
  vercelTeamId: string | null;
}

export async function getVercelCliSandboxSetup(_params: {
  userId: string;
  sessionRecord: SessionVercelCliContext;
}): Promise<VercelCliSandboxSetup> {
  void _params;

  return {
    projectLink: null,
  };
}

export async function syncVercelCliAuthToSandbox(_params: {
  sandbox: Sandbox;
  setup: VercelCliSandboxSetup;
}): Promise<void> {
  void _params;
}
