import { beforeEach, describe, expect, mock, test } from "bun:test";

// The AI Gateway credential a sandbox brokers is opt-in per call, so it has to
// survive the trip from `connectSandbox` options down to create/connect. These
// tests pin that threading with `VercelSandbox` mocked out: nothing here talks
// to the Vercel SDK.

type SandboxConfig = Record<string, unknown>;
type ConnectCall = { name: string; options: SandboxConfig };

const createCalls: SandboxConfig[] = [];
const connectCalls: ConnectCall[] = [];
let connectError: Error | undefined;

mock.module("./sandbox.ts", () => ({
  VercelSandbox: {
    create: async (config: SandboxConfig) => {
      createCalls.push(config);
      return { name: "created" };
    },
    connect: async (name: string, options: SandboxConfig) => {
      connectCalls.push({ name, options });
      if (connectError) {
        throw connectError;
      }
      return { name };
    },
  },
}));

const { connectVercel } = await import("./connect");

beforeEach(() => {
  createCalls.length = 0;
  connectCalls.length = 0;
  connectError = undefined;
});

describe("connectVercel", () => {
  test("passes the caller's AI Gateway key to a named sandbox connect", async () => {
    await connectVercel(
      { sandboxName: "session_123" },
      { aiGatewayApiKey: "harness-turn-key" },
    );

    expect(connectCalls[0]?.name).toBe("session_123");
    expect(connectCalls[0]?.options.aiGatewayApiKey).toBe("harness-turn-key");
  });

  test("connects without an AI Gateway key when the caller does not opt in", async () => {
    await connectVercel({ sandboxName: "session_123" }, { resume: true });

    expect(connectCalls[0]?.options.aiGatewayApiKey).toBeUndefined();
  });

  test("passes the caller's AI Gateway key when creating a sandbox", async () => {
    await connectVercel({}, { aiGatewayApiKey: "harness-turn-key" });

    expect(connectCalls).toHaveLength(0);
    expect(createCalls[0]?.aiGatewayApiKey).toBe("harness-turn-key");
  });

  test("creates without an AI Gateway key when the caller does not opt in", async () => {
    await connectVercel({}, { ports: [3000] });

    expect(createCalls[0]?.aiGatewayApiKey).toBeUndefined();
  });

  test("keeps the AI Gateway key when a missing named sandbox is recreated", async () => {
    connectError = new Error("Failed with status code 404");

    await connectVercel(
      { sandboxName: "session_123" },
      { aiGatewayApiKey: "harness-turn-key", createIfMissing: true },
    );

    expect(createCalls[0]?.aiGatewayApiKey).toBe("harness-turn-key");
  });
});
