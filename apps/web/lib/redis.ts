import Redis from "ioredis";

let warnedMissingRedisConfig = false;

export function getRedisUrl(): string | null {
  return process.env.REDIS_URL ?? process.env.KV_URL ?? null;
}

export function isRedisConfigured(): boolean {
  return getRedisUrl() !== null;
}

function createNoopRedisClient(): Redis {
  if (!warnedMissingRedisConfig) {
    warnedMissingRedisConfig = true;
    console.warn(
      "[redis] REDIS_URL/KV_URL not set. Redis-backed stream resume and stop signaling are disabled.",
    );
  }

  const noopRedisClient = {
    on: () => noopRedisClient,
    publish: async () => 0,
    subscribe: async () => 0,
    unsubscribe: async () => 0,
    disconnect: () => undefined,
  };

  return noopRedisClient as unknown as Redis;
}

export function createRedisClient(): Redis {
  const url = getRedisUrl();
  if (!url) {
    return createNoopRedisClient();
  }

  return new Redis(url);
}
