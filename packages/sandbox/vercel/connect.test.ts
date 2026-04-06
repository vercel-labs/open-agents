import { beforeEach, describe, expect, mock, test } from "bun:test";

const createSpy = mock(async (_config: unknown) => ({
  kind: "created" as const,
}));
const connectSpy = mock(async (_name: string, _options: unknown) => ({
  kind: "connected" as const,
}));

mock.module("./sandbox", () => ({
  VercelSandbox: {
    create: createSpy,
    connect: connectSpy,
  },
}));

const { connectVercel } = await import("./connect");

describe("connectVercel", () => {
  beforeEach(() => {
    createSpy.mockClear();
    connectSpy.mockClear();
  });

  test("creates a named sandbox when source is provided", async () => {
    await connectVercel({
      sandboxName: "session_1",
      source: { repo: "https://github.com/acme/widgets" },
    });

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(connectSpy).not.toHaveBeenCalled();
    expect(createSpy.mock.calls[0]?.[0]).toMatchObject({
      name: "session_1",
      source: { url: "https://github.com/acme/widgets" },
    });
  });

  test("creates a new named sandbox instead of reconnecting for fresh sessions", async () => {
    await connectVercel(
      { sandboxName: "session_2" },
      { timeout: 30_000, persistent: true },
    );

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(connectSpy).not.toHaveBeenCalled();
    expect(createSpy.mock.calls[0]?.[0]).toMatchObject({
      name: "session_2",
      timeout: 30_000,
      persistent: true,
    });
  });

  test("reconnects a named sandbox when resume is requested", async () => {
    await connectVercel(
      { sandboxName: "session_3" },
      { resume: true, timeout: 45_000 },
    );

    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).not.toHaveBeenCalled();
    expect(connectSpy.mock.calls[0]).toEqual([
      "session_3",
      expect.objectContaining({
        resume: true,
        remainingTimeout: 45_000,
      }),
    ]);
  });
});
