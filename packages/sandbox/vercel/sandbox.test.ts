import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

const portDomains = new Map<number, string>();
const missingPorts = new Set<number>();
type MockWaitResult = {
  exitCode: number;
  stdout: () => Promise<string>;
  stderr: () => Promise<string>;
};
type MockRunCommandResult = {
  exitCode?: number;
  cmdId: string;
  stdout: () => Promise<string>;
  stderr?: () => Promise<string>;
  wait?: (params?: { signal?: AbortSignal }) => Promise<MockWaitResult>;
};
type MockRunCommandParams = {
  cmd?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
};

const createCalls: Array<Record<string, unknown>> = [];
const runCommandCalls: MockRunCommandParams[] = [];

let runCommandMock = async (
  _params?: MockRunCommandParams,
): Promise<MockRunCommandResult> => ({
  exitCode: 0,
  cmdId: "cmd-1",
  stdout: async () => "",
});
let lastRunCommandEnv: Record<string, string> | undefined;

function domainForPort(port: number): string {
  if (missingPorts.has(port)) {
    throw new Error(`No route found for port ${port}`);
  }

  const domain = portDomains.get(port);
  if (!domain) {
    throw new Error(`No route found for port ${port}`);
  }

  return domain;
}

mock.module("@vercel/sandbox", () => ({
  Sandbox: {
    create: async (params: Record<string, unknown>) => {
      createCalls.push(params);
      return {
        sandboxId: "sbx-created",
        routes: Array.from(portDomains.keys()).map((port) => {
          const domain =
            portDomains.get(port) ?? `https://sbx-${port}.vercel.run`;
          const subdomain = new URL(domain).host.replace(".vercel.run", "");
          return { port, subdomain };
        }),
        domain: (port: number) => domainForPort(port),
        runCommand: async (params: MockRunCommandParams) => {
          runCommandCalls.push(params);
          lastRunCommandEnv = params.env;
          return runCommandMock(params);
        },
        stop: async () => {},
      };
    },
    get: async ({ sandboxId }: { sandboxId: string }) => ({
      sandboxId,
      routes: Array.from(portDomains.keys()).map((port) => {
        const domain =
          portDomains.get(port) ?? `https://sbx-${port}.vercel.run`;
        const subdomain = new URL(domain).host.replace(".vercel.run", "");
        return { port, subdomain };
      }),
      domain: (port: number) => domainForPort(port),
      runCommand: async (params: MockRunCommandParams) => {
        runCommandCalls.push(params);
        lastRunCommandEnv = params.env;
        return runCommandMock(params);
      },
      stop: async () => {},
    }),
  },
}));

let sandboxModule: typeof import("./sandbox");

beforeAll(async () => {
  sandboxModule = await import("./sandbox");
});

beforeEach(() => {
  createCalls.length = 0;
  runCommandCalls.length = 0;
  portDomains.clear();
  missingPorts.clear();
  portDomains.set(80, "https://sbx-80.vercel.run");
  runCommandMock = async () => ({
    exitCode: 0,
    cmdId: "cmd-1",
    stdout: async () => "",
  });
  lastRunCommandEnv = undefined;
});

describe("VercelSandbox.environmentDetails", () => {
  test("skips preview URLs for ports that are missing routes", async () => {
    portDomains.set(3000, "https://sbx-3000.vercel.run");
    missingPorts.add(5173);

    const sandbox = await sandboxModule.VercelSandbox.connect("sbx-test", {
      ports: [3000, 5173],
      remainingTimeout: 0,
    });

    const details = sandbox.environmentDetails;

    expect(details).toContain("Dev server preview URLs");
    expect(details).toContain("Port 3000: https://sbx-3000.vercel.run");
    expect(details).not.toContain("Port 5173:");
  });

  test("uses first routable declared port for host when port 80 is unavailable", async () => {
    missingPorts.add(80);
    portDomains.set(3000, "https://sbx-3000.vercel.run");

    const sandbox = await sandboxModule.VercelSandbox.connect("sbx-test", {
      ports: [3000, 5173],
      remainingTimeout: 0,
    });

    expect(sandbox.host).toBe("sbx-3000.vercel.run");
  });

  test("does not render an undefined host in environment details", async () => {
    missingPorts.add(80);
    missingPorts.add(3000);

    const sandbox = await sandboxModule.VercelSandbox.connect("sbx-test", {
      ports: [3000],
      remainingTimeout: 0,
    });

    const details = sandbox.environmentDetails;

    expect(details).not.toContain("Sandbox host: undefined");
    expect(details).not.toContain("Sandbox host:");
  });

  test("resolves host from SDK routes when reconnect did not pass ports", async () => {
    missingPorts.add(80);
    portDomains.set(3000, "https://sbx-3000.vercel.run");

    const sandbox = await sandboxModule.VercelSandbox.connect("sbx-test", {
      remainingTimeout: 0,
    });

    expect(sandbox.host).toBe("sbx-3000.vercel.run");
    expect(sandbox.environmentDetails).toContain(
      "Sandbox host: sbx-3000.vercel.run",
    );
  });

  test("injects runtime preview env vars into command execution", async () => {
    missingPorts.add(80);
    portDomains.set(3000, "https://sbx-3000.vercel.run");

    const sandbox = await sandboxModule.VercelSandbox.connect("sbx-test", {
      ports: [3000],
      remainingTimeout: 0,
    });

    await sandbox.exec("echo test", "/vercel/sandbox", 5_000);

    expect(lastRunCommandEnv?.SANDBOX_HOST).toBe("sbx-3000.vercel.run");
    expect(lastRunCommandEnv?.SANDBOX_URL_3000).toBe(
      "https://sbx-3000.vercel.run",
    );
  });
});

describe("VercelSandbox.create", () => {
  test("creates from base snapshot and clones git source", async () => {
    await sandboxModule.VercelSandbox.create({
      baseSnapshotId: "snap-base-1",
      source: {
        url: "https://github.com/open-harness/example",
        branch: "main",
      },
    });

    expect(createCalls.length).toBe(1);
    expect(createCalls[0]?.source).toEqual({
      type: "snapshot",
      snapshotId: "snap-base-1",
    });
    expect(runCommandCalls[0]).toEqual({
      cmd: "git",
      args: [
        "clone",
        "--branch",
        "main",
        "https://github.com/open-harness/example",
        ".",
      ],
      cwd: "/vercel/sandbox",
    });
  });

  test("creates empty git repo from base snapshot", async () => {
    await sandboxModule.VercelSandbox.create({
      baseSnapshotId: "snap-base-1",
    });

    expect(createCalls.length).toBe(1);
    expect(createCalls[0]?.source).toEqual({
      type: "snapshot",
      snapshotId: "snap-base-1",
    });
    expect(runCommandCalls[0]).toEqual({
      cmd: "git",
      args: ["init"],
      cwd: "/vercel/sandbox",
    });
  });
});

describe("VercelSandbox.execDetached", () => {
  test("returns commandId when quick-failure timer elapses before command exits", async () => {
    runCommandMock = async () => ({
      cmdId: "cmd-detached-running",
      stdout: async () => "",
      wait: async () => await new Promise<MockWaitResult>(() => {}),
    });

    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((
      handler: Parameters<typeof setTimeout>[0],
      _timeout?: Parameters<typeof setTimeout>[1],
      ...args: unknown[]
    ) => {
      if (typeof handler === "function") {
        handler();
      }
      return originalSetTimeout(() => undefined, 0, ...args);
    }) as typeof setTimeout;

    try {
      const sandbox = await sandboxModule.VercelSandbox.connect("sbx-test", {
        ports: [3000],
        remainingTimeout: 0,
      });

      const result = await sandbox.execDetached(
        "bun run dev",
        "/vercel/sandbox",
      );

      expect(result).toEqual({ commandId: "cmd-detached-running" });
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  test("throws when detached wait fails before timer elapses", async () => {
    runCommandMock = async () => ({
      cmdId: "cmd-detached-error",
      stdout: async () => "",
      wait: async () => {
        throw new Error("wait failed");
      },
    });

    const sandbox = await sandboxModule.VercelSandbox.connect("sbx-test", {
      ports: [3000],
      remainingTimeout: 0,
    });

    expect(
      sandbox.execDetached("bun run dev", "/vercel/sandbox"),
    ).rejects.toThrow("wait failed");
  });

  test("throws with stderr when command exits quickly with non-zero code", async () => {
    runCommandMock = async () => ({
      cmdId: "cmd-detached-fail",
      stdout: async () => "",
      wait: async () => ({
        exitCode: 1,
        stdout: async () => "",
        stderr: async () => "npm ERR! code ENOENT",
      }),
    });

    const sandbox = await sandboxModule.VercelSandbox.connect("sbx-test", {
      ports: [3000],
      remainingTimeout: 0,
    });

    expect(
      sandbox.execDetached("npm run dev", "/vercel/sandbox"),
    ).rejects.toThrow("npm ERR! code ENOENT");
  });
});
