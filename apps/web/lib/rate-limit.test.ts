import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

type RedisOptions = Record<string, unknown>;
type RedisTransactionResult = [Error | null, unknown];
type RedisExecResults = RedisTransactionResult[] | null;

const redisInstances: MockRedis[] = [];
const redisState: {
  execResults: RedisExecResults | Promise<RedisExecResults>;
  ttl: number;
} = {
  execResults: [
    [null, 1],
    [null, 1],
  ],
  ttl: 60_000,
};

function createMockPipeline() {
  const pipeline = {
    incr: mock((_key: string) => pipeline),
    pexpire: mock((_key: string, _windowMs: number, _mode: string) => pipeline),
    exec: mock(async () => redisState.execResults),
  };

  return pipeline;
}

class MockRedis {
  options: RedisOptions;
  on = mock((_event: string, _handler: (error: Error) => void) => this);
  disconnect = mock(() => undefined);
  pttl = mock(async (_key: string) => redisState.ttl);
  multi = mock(() => createMockPipeline());

  constructor(options: RedisOptions) {
    this.options = options;
    redisInstances.push(this);
  }
}

mock.module("ioredis", () => ({
  default: MockRedis,
}));

const originalRedisUrl = process.env.REDIS_URL;
const originalKvUrl = process.env.KV_URL;
const originalNodeEnv = process.env.NODE_ENV;
const originalRateLimitTimeoutMs = process.env.RATE_LIMIT_TIMEOUT_MS;
const nodeEnvKey = "NODE_ENV" as keyof NodeJS.ProcessEnv;
let moduleVersion = 0;

async function loadRateLimitModule() {
  moduleVersion += 1;
  return import(`./rate-limit?test=${moduleVersion}`);
}

beforeEach(() => {
  redisInstances.length = 0;
  redisState.execResults = [
    [null, 1],
    [null, 1],
  ];
  redisState.ttl = 60_000;
});

afterEach(() => {
  if (originalRedisUrl === undefined) {
    delete process.env.REDIS_URL;
  } else {
    process.env.REDIS_URL = originalRedisUrl;
  }

  if (originalKvUrl === undefined) {
    delete process.env.KV_URL;
  } else {
    process.env.KV_URL = originalKvUrl;
  }

  if (originalRateLimitTimeoutMs === undefined) {
    delete process.env.RATE_LIMIT_TIMEOUT_MS;
  } else {
    process.env.RATE_LIMIT_TIMEOUT_MS = originalRateLimitTimeoutMs;
  }

  process.env[nodeEnvKey] = originalNodeEnv;
});

describe("checkRateLimit", () => {
  test("does not enforce limits locally when Redis is not configured", async () => {
    delete process.env.REDIS_URL;
    delete process.env.KV_URL;
    process.env[nodeEnvKey] = "test";
    const { checkRateLimit } = await loadRateLimitModule();

    const key = `test:${crypto.randomUUID()}`;
    expect(
      await checkRateLimit({ key, limit: 2, windowMs: 60_000 }),
    ).toBeNull();
    expect(
      await checkRateLimit({ key, limit: 2, windowMs: 60_000 }),
    ).toBeNull();

    const response = await checkRateLimit({ key, limit: 2, windowMs: 60_000 });
    expect(response).toBeNull();
  });

  test("fails closed in production when Redis is not configured", async () => {
    delete process.env.REDIS_URL;
    delete process.env.KV_URL;
    process.env[nodeEnvKey] = "production";
    const { checkRateLimit } = await loadRateLimitModule();

    const response = await checkRateLimit({
      key: `test:${crypto.randomUUID()}`,
      limit: 2,
      windowMs: 60_000,
    });

    expect(response?.status).toBe(503);
    expect(response?.headers.get("Retry-After")).toBe("30");
  });

  test("allows Redis commands to queue during initial connection", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env[nodeEnvKey] = "production";
    const { checkRateLimit } = await loadRateLimitModule();

    await expect(
      checkRateLimit({
        key: `test:${crypto.randomUUID()}`,
        limit: 2,
        windowMs: 60_000,
      }),
    ).resolves.toBeNull();

    expect(redisInstances).toHaveLength(1);
    expect(redisInstances[0]?.options.enableOfflineQueue).toBeUndefined();
  });

  test("fails closed when the Redis expiry command fails", async () => {
    const originalConsoleError = console.error;
    console.error = mock(() => undefined) as unknown as typeof console.error;
    try {
      process.env.REDIS_URL = "redis://localhost:6379";
      process.env[nodeEnvKey] = "production";
      redisState.execResults = [
        [null, 1],
        [new Error("ERR syntax error"), null],
      ];
      const { checkRateLimit } = await loadRateLimitModule();

      const response = await checkRateLimit({
        key: `test:${crypto.randomUUID()}`,
        limit: 2,
        windowMs: 60_000,
      });

      expect(response?.status).toBe(503);
      expect(response?.headers.get("Retry-After")).toBe("30");
      expect(redisInstances[0]?.disconnect).toHaveBeenCalledTimes(1);
    } finally {
      console.error = originalConsoleError;
    }
  });

  test("returns a retry response when the Redis count exceeds the limit", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env[nodeEnvKey] = "production";
    redisState.execResults = [
      [null, 3],
      [null, 0],
    ];
    redisState.ttl = 12_345;
    const { checkRateLimit } = await loadRateLimitModule();

    const response = await checkRateLimit({
      key: `test:${crypto.randomUUID()}`,
      limit: 2,
      windowMs: 60_000,
    });

    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBe("13");
  });

  test("fails closed when the Redis check times out", async () => {
    const originalConsoleError = console.error;
    console.error = mock(() => undefined) as unknown as typeof console.error;
    try {
      process.env.REDIS_URL = "redis://localhost:6379";
      process.env.RATE_LIMIT_TIMEOUT_MS = "1";
      process.env[nodeEnvKey] = "production";
      redisState.execResults = new Promise<RedisExecResults>(() => undefined);
      const { checkRateLimit } = await loadRateLimitModule();

      const response = await checkRateLimit({
        key: `test:${crypto.randomUUID()}`,
        limit: 2,
        windowMs: 60_000,
      });

      expect(response?.status).toBe(503);
      expect(response?.headers.get("Retry-After")).toBe("30");
      expect(redisInstances[0]?.disconnect).toHaveBeenCalledTimes(1);
    } finally {
      console.error = originalConsoleError;
    }
  });
});
