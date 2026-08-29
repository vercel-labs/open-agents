import { afterAll, describe, expect, mock, test } from "bun:test";

const originalDeploymentId = process.env.VERCEL_DEPLOYMENT_ID;
const originalBaseSnapshotId = process.env.VERCEL_SANDBOX_BASE_SNAPSHOT_ID;
const resolvedTemplateNames: string[] = [];
let templateLookupFailuresRemaining = 0;

mock.module("@open-agents/sandbox/vercel", () => ({
  createVercelSnapshotTemplateName: (deploymentId: string) =>
    `template-${deploymentId}`,
  resolveVercelSnapshotTemplateId: async (templateName: string) => {
    resolvedTemplateNames.push(templateName);
    if (templateLookupFailuresRemaining > 0) {
      templateLookupFailuresRemaining -= 1;
      throw new Error("Vercel API unavailable");
    }
    return "snap-deployment";
  },
}));

afterAll(() => {
  if (originalDeploymentId === undefined) {
    delete process.env.VERCEL_DEPLOYMENT_ID;
  } else {
    process.env.VERCEL_DEPLOYMENT_ID = originalDeploymentId;
  }

  if (originalBaseSnapshotId === undefined) {
    delete process.env.VERCEL_SANDBOX_BASE_SNAPSHOT_ID;
  } else {
    process.env.VERCEL_SANDBOX_BASE_SNAPSHOT_ID = originalBaseSnapshotId;
  }
});

describe("resolveSandboxBaseSnapshotId", () => {
  test("prefers the deployment-prewarmed template over the raw base snapshot", async () => {
    process.env.VERCEL_DEPLOYMENT_ID = "dpl-test";
    process.env.VERCEL_SANDBOX_BASE_SNAPSHOT_ID = "snap-explicit-base";

    const { resolveSandboxBaseSnapshotId } = await import("./base-snapshot");

    await expect(resolveSandboxBaseSnapshotId()).resolves.toBe(
      "snap-deployment",
    );
    expect(resolvedTemplateNames).toEqual(["template-dpl-test"]);
  });

  test("caches the resolved template id across calls", async () => {
    process.env.VERCEL_DEPLOYMENT_ID = "dpl-test";

    const { resolveSandboxBaseSnapshotId } = await import("./base-snapshot");
    const callCountBefore = resolvedTemplateNames.length;

    await expect(resolveSandboxBaseSnapshotId()).resolves.toBe(
      "snap-deployment",
    );
    await expect(resolveSandboxBaseSnapshotId()).resolves.toBe(
      "snap-deployment",
    );
    expect(resolvedTemplateNames.length).toBe(callCountBefore);
  });

  test("retries after a transient template lookup failure", async () => {
    // Use an isolated module instance so the previous tests' cached
    // resolution does not short-circuit the failure path.
    process.env.VERCEL_DEPLOYMENT_ID = "dpl-retry";
    const { resolveSandboxBaseSnapshotId } = await import(
      `./base-snapshot.ts?retry-${Date.now()}`
    );

    templateLookupFailuresRemaining = 1;
    await expect(resolveSandboxBaseSnapshotId()).rejects.toThrow(
      "Vercel API unavailable",
    );

    await expect(resolveSandboxBaseSnapshotId()).resolves.toBe(
      "snap-deployment",
    );
  });
});
