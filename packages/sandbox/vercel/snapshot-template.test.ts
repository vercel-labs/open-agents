import { describe, expect, mock, test } from "bun:test";
import type { SandboxConnectConfig } from "../factory";
import type { ExecResult } from "../interface";
import {
  createVercelSnapshotTemplateName,
  ensureVercelSnapshotTemplate,
} from "./snapshot-template";

function createSandbox() {
  return {
    workingDirectory: "/vercel/sandbox",
    exec: async (): Promise<ExecResult> => ({
      success: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      truncated: false,
    }),
    stop: mock(async () => {}),
    snapshot: mock(async () => ({ snapshotId: "snap-created" })),
  };
}

describe("createVercelSnapshotTemplateName", () => {
  test("creates a stable bounded template name", () => {
    const first = createVercelSnapshotTemplateName(" dpl_example ");
    const second = createVercelSnapshotTemplateName("dpl_example");

    expect(first).toBe(second);
    expect(first).toMatch(/^open-agents-sbx-tpl-[a-f0-9]{20}$/);
  });
});

describe("ensureVercelSnapshotTemplate", () => {
  test("reuses an existing template snapshot", async () => {
    const connectSandbox = mock(async () => createSandbox());

    const result = await ensureVercelSnapshotTemplate(
      {
        templateName: "open-agents-sbx-tpl-existing",
        sandboxTimeoutMs: 300_000,
      },
      {
        connectSandbox,
        resolveSnapshotId: async () => "snap-existing",
      },
    );

    expect(connectSandbox).not.toHaveBeenCalled();
    expect(result).toEqual({
      templateName: "open-agents-sbx-tpl-existing",
      snapshotId: "snap-existing",
      created: false,
    });
  });

  test("prepares and snapshots a missing template", async () => {
    const sandbox = createSandbox();
    const connectCalls: SandboxConnectConfig[] = [];
    const prepare = mock(async () => {});

    const result = await ensureVercelSnapshotTemplate(
      {
        templateName: "open-agents-sbx-tpl-new",
        sandboxTimeoutMs: 300_000,
        baseSnapshotId: "snap-base",
        ports: [3000, 5001],
        prepare,
      },
      {
        connectSandbox: async (config) => {
          connectCalls.push(config);
          return sandbox;
        },
        resolveSnapshotId: async () => undefined,
      },
    );

    expect(connectCalls).toEqual([
      {
        state: {
          type: "vercel",
          sandboxName: "open-agents-sbx-tpl-new",
        },
        options: {
          timeout: 300_000,
          persistent: false,
          resume: true,
          createIfMissing: true,
          skipGitWorkspaceBootstrap: true,
          baseSnapshotId: "snap-base",
          ports: [3000, 5001],
        },
      },
    ]);
    expect(prepare).toHaveBeenCalledWith(sandbox);
    expect(sandbox.snapshot).toHaveBeenCalledTimes(1);
    expect(sandbox.stop).not.toHaveBeenCalled();
    expect(result).toEqual({
      templateName: "open-agents-sbx-tpl-new",
      snapshotId: "snap-created",
      created: true,
    });
  });

  test("stops the template sandbox when preparation fails", async () => {
    const sandbox = createSandbox();

    const result = ensureVercelSnapshotTemplate(
      {
        templateName: "open-agents-sbx-tpl-failed",
        sandboxTimeoutMs: 300_000,
        prepare: async () => {
          throw new Error("install failed");
        },
      },
      {
        connectSandbox: async () => sandbox,
        resolveSnapshotId: async () => undefined,
      },
    );

    await expect(result).rejects.toThrow("install failed");
    expect(sandbox.stop).toHaveBeenCalledTimes(1);
    expect(sandbox.snapshot).not.toHaveBeenCalled();
  });
});
