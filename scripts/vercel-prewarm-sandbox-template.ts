/**
 * Prewarm the deployment-scoped Vercel Sandbox template used by fresh user
 * sandboxes. Vercel builds provide a stable deployment ID, so application
 * runtimes can resolve the template's current snapshot without a copied ID.
 */

import {
  createVercelSnapshotTemplateName,
  ensureVercelSnapshotTemplate,
} from "@open-agents/sandbox/vercel";
import {
  DEFAULT_SANDBOX_PORTS,
  DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
  DEFAULT_SANDBOX_TIMEOUT_MS,
} from "../apps/web/lib/sandbox/config.ts";
import { prepareSnapshotSandboxRuntimeProfile } from "./lib/harness-runtime-profile.ts";

function shouldPrewarmVercelBuild(): boolean {
  return Boolean(
    process.env.VERCEL?.trim() && process.env.VERCEL_DEPLOYMENT_ID?.trim(),
  );
}

async function main() {
  if (!shouldPrewarmVercelBuild()) {
    console.log(
      "Skipping Vercel sandbox template prewarm outside a Vercel deployment build.",
    );
    return;
  }

  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID?.trim();
  if (!deploymentId) {
    throw new Error("VERCEL_DEPLOYMENT_ID is required for template prewarm.");
  }

  const result = await ensureVercelSnapshotTemplate({
    templateName: createVercelSnapshotTemplateName(deploymentId),
    sandboxTimeoutMs: DEFAULT_SANDBOX_TIMEOUT_MS,
    baseSnapshotId: DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
    ports: DEFAULT_SANDBOX_PORTS,
    prepare: prepareSnapshotSandboxRuntimeProfile,
    log: (message) => console.log(message),
  });

  console.log(
    `${result.created ? "Created" : "Reused"} Vercel sandbox template ${result.templateName} with snapshot ${result.snapshotId}.`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
