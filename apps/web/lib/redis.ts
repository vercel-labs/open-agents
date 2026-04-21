import Redis, { type RedisOptions } from "ioredis";

const warnedMissingRedisFeatures = new Set<string>();

type RedisConnectionOptions = Omit<RedisOptions, "tls"> & {
  tls?: RedisOptions["tls"] | string;
} & Record<string, unknown>;

function decodeRedisUrlComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeRedisHostname(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }

  return hostname;
}

function applyRedisQueryOptions(
  searchParams: URLSearchParams,
  options: RedisConnectionOptions,
): void {
  for (const [key, value] of searchParams.entries()) {
    if (key === "family") {
      if (options.family !== undefined) {
        continue;
      }

      const family = Number.parseInt(value, 10);
      if (!Number.isNaN(family)) {
        options.family = family;
      }
      continue;
    }

    if (key === "db") {
      if (options.db !== undefined) {
        continue;
      }

      const db = Number.parseInt(value, 10);
      if (!Number.isNaN(db)) {
        options.db = db;
      }
      continue;
    }

    if (options[key] === undefined) {
      options[key] = value;
    }
  }
}

export function getRedisUrl(): string | null {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (redisUrl) return redisUrl;

  const kvUrl = process.env.KV_URL?.trim();
  if (kvUrl) return kvUrl;

  return null;
}

export function getRedisConnectionOptions(url: string): RedisConnectionOptions {
  if (/^[0-9]+$/.test(url)) {
    return { port: Number.parseInt(url, 10) };
  }

  const options: RedisConnectionOptions = {};

  if (url.startsWith("/")) {
    const [path, query = ""] = url.split("?", 2);
    options.path = path;
    applyRedisQueryOptions(new URLSearchParams(query), options);
    return options;
  }

  const parsedUrl = new URL(url.includes("://") ? url : `redis://${url}`);

  if (parsedUrl.protocol !== "redis:" && parsedUrl.protocol !== "rediss:") {
    throw new Error(`Unsupported Redis URL protocol: ${parsedUrl.protocol}`);
  }

  if (parsedUrl.username) {
    options.username = decodeRedisUrlComponent(parsedUrl.username);
  }

  if (parsedUrl.password) {
    options.password = decodeRedisUrlComponent(parsedUrl.password);
  }

  if (parsedUrl.hostname) {
    options.host = normalizeRedisHostname(parsedUrl.hostname);
  }

  if (parsedUrl.port) {
    options.port = Number.parseInt(parsedUrl.port, 10);
  }

  const db = parsedUrl.pathname.replace(/^\/+/, "");
  if (db.length > 0) {
    const dbNumber = Number.parseInt(db, 10);
    if (!Number.isNaN(dbNumber)) {
      options.db = dbNumber;
    }
  }

  applyRedisQueryOptions(parsedUrl.searchParams, options);

  if (parsedUrl.protocol === "rediss:" && options.tls === undefined) {
    options.tls = {};
  }

  return options;
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

  const client = new Redis(getRedisConnectionOptions(url) as RedisOptions);
  client.on("error", (error) => {
    console.error(`[redis] ${clientName} error:`, error);
  });

  return client;
}
