import { createHash } from "node:crypto";
import { Sandbox as VercelSandboxSDK } from "@vercel/sandbox";
import {
  defaultConnectSnapshotSandbox,
  resolveSnapshotLog,
  runSnapshotLifecycle,
  type SnapshotSandbox,
  type SnapshotSandboxConnector,
  toErrorMessage,
} from "./snapshot-lifecycle.ts";

const VERCEL_SNAPSHOT_TEMPLATE_CONTRACT_VERSION = 1;

export interface EnsureVercelSnapshotTemplateOptions {
  templateName: string;
  sandboxTimeoutMs: number;
  baseSnapshotId?: string;
  ports?: number[];
  env?: Record<string, string>;
  prepare?: (sandbox: SnapshotSandbox) => Promise<void>;
  log?: (message: string) => void;
}

export interface EnsureVercelSnapshotTemplateResult {
  templateName: string;
  snapshotId: string;
  created: boolean;
}

interface VercelSnapshotTemplateDependencies {
  connectSandbox?: SnapshotSandboxConnector;
  resolveSnapshotId?: (templateName: string) => Promise<string | undefined>;
}

function isSandboxNotFoundError(error: unknown): boolean {
  const message = toErrorMessage(error).toLowerCase();
  return message.includes("status code 404") || message.includes("not found");
}

export function createVercelSnapshotTemplateName(deploymentId: string): string {
  const scope = createHash("sha256")
    .update(
      `${VERCEL_SNAPSHOT_TEMPLATE_CONTRACT_VERSION}:${deploymentId.trim()}`,
    )
    .digest("hex")
    .slice(0, 20);

  return `open-agents-sbx-tpl-${scope}`;
}

export async function resolveVercelSnapshotTemplateId(
  templateName: string,
): Promise<string | undefined> {
  try {
    const sandbox = await VercelSandboxSDK.get({
      name: templateName,
      resume: false,
    });
    return sandbox.currentSnapshotId;
  } catch (error) {
    if (isSandboxNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }
}

export async function ensureVercelSnapshotTemplate(
  options: EnsureVercelSnapshotTemplateOptions,
  dependencies: VercelSnapshotTemplateDependencies = {},
): Promise<EnsureVercelSnapshotTemplateResult> {
  const log = resolveSnapshotLog(options.log);
  const connectSnapshotSandbox =
    dependencies.connectSandbox ?? defaultConnectSnapshotSandbox;
  const resolveSnapshotId =
    dependencies.resolveSnapshotId ?? resolveVercelSnapshotTemplateId;

  const existingSnapshotId = await resolveSnapshotId(options.templateName);
  if (existingSnapshotId) {
    log(
      `Reusing snapshot ${existingSnapshotId} from template ${options.templateName}.`,
    );
    return {
      templateName: options.templateName,
      snapshotId: existingSnapshotId,
      created: false,
    };
  }

  const { snapshotId } = await runSnapshotLifecycle({
    log,
    connect: () => {
      log(`Creating snapshot template ${options.templateName}.`);
      return connectSnapshotSandbox({
        state: { type: "vercel", sandboxName: options.templateName },
        options: {
          timeout: options.sandboxTimeoutMs,
          persistent: false,
          resume: true,
          createIfMissing: true,
          skipGitWorkspaceBootstrap: true,
          ...(options.baseSnapshotId !== undefined && {
            baseSnapshotId: options.baseSnapshotId,
          }),
          ...(options.ports !== undefined && { ports: options.ports }),
          ...(options.env !== undefined && { env: options.env }),
        },
      });
    },
    prepare: async (sandbox) => {
      if (options.prepare) {
        log("Preparing sandbox template runtime profile.");
        await options.prepare(sandbox);
      }
    },
    creatingSnapshotMessage: `Creating snapshot from template ${options.templateName}.`,
    stopFailureMessage: "Failed to stop sandbox after template setup attempt",
  });

  return {
    templateName: options.templateName,
    snapshotId,
    created: true,
  };
}
