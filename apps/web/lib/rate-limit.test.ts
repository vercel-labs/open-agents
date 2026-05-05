import { afterEach, describe, expect, test } from "bun:test";
import { checkRateLimit } from "./rate-limit";

const originalRedisUrl = process.env.REDIS_URL;
const originalKvUrl = process.env.KV_URL;
const originalNodeEnv = process.env.NODE_ENV;
const nodeEnvKey = "NODE_ENV" as keyof NodeJS.ProcessEnv;

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

  process.env[nodeEnvKey] = originalNodeEnv;
});

describe("checkRateLimit", () => {
  test("does not enforce limits locally when Redis is not configured", async () => {
    delete process.env.REDIS_URL;
    delete process.env.KV_URL;
    process.env[nodeEnvKey] = "test";

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

    const response = await checkRateLimit({
      key: `test:${crypto.randomUUID()}`,
      limit: 2,
      windowMs: 60_000,
    });

    expect(response?.status).toBe(503);
    expect(response?.headers.get("Retry-After")).toBe("30");
  });
});
