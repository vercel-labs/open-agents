import {
  createVercelSnapshotTemplateName,
  resolveVercelSnapshotTemplateId,
} from "@open-agents/sandbox/vercel";
import { DEFAULT_SANDBOX_BASE_SNAPSHOT_ID } from "./config.ts";

let deploymentSnapshotId: Promise<string> | undefined;

export async function resolveSandboxBaseSnapshotId(): Promise<
  string | undefined
> {
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID?.trim();
  if (!deploymentId) {
    return DEFAULT_SANDBOX_BASE_SNAPSHOT_ID;
  }

  if (!deploymentSnapshotId) {
    const pending = resolveVercelSnapshotTemplateId(
      createVercelSnapshotTemplateName(deploymentId),
    ).then((snapshotId) => {
      if (!snapshotId) {
        throw new Error(
          "Vercel sandbox template is missing for this deployment. Ensure the web build runs sandbox:prewarm.",
        );
      }
      return snapshotId;
    });

    // Never cache a rejection: a transient template-lookup failure must not
    // poison every later sandbox creation on this server instance.
    pending.catch(() => {
      if (deploymentSnapshotId === pending) {
        deploymentSnapshotId = undefined;
      }
    });

    deploymentSnapshotId = pending;
  }

  return deploymentSnapshotId;
}
