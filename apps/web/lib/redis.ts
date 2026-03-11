import Redis from "ioredis";

const warnedMissingRedisFeatures = new Set<string>();

export function getRedisUrl(): string | null {
  return process.env.REDIS_URL ?? process.env.KV_URL ?? null;
}

export function isRedisConfigured(): boolean {
  return getRedisUrl() !== null;
}

export function warnRedisDisabled(feature: string): void {
  if (warnedMissingRedisFeatures.has(feature)) {
    return;
  }

  warnedMissingRedisFeatures.add(feature);
  console.error(
    `[redis] ${feature} is disabled because REDIS_URL/KV_URL is not configured.`,
  );
}

export function createRedisClient(clientName = "redis-client"): Redis {
  const url = getRedisUrl();
  if (!url) {
    throw new Error("REDIS_URL or KV_URL environment variable is required");
  }

  const client = new Redis(url);
  client.on("error", (error) => {
    console.error(`[redis] ${clientName} error:`, error);
  });

  return client;
}
