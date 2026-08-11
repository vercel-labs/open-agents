import { getVercelOidcToken } from "@vercel/oidc";

/**
 * An AI_GATEWAY_API_KEY present at process start is a deployment-configured
 * static key. Keys written into process.env later are minted OIDC tokens;
 * those expire, so they must never short-circuit a refresh.
 */
const bootGatewayApiKey = process.env.AI_GATEWAY_API_KEY || undefined;

export function resolveGatewayApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN || undefined;
}

function staticGatewayApiKeyFor(env: NodeJS.ProcessEnv): string | undefined {
  if (!env.AI_GATEWAY_API_KEY) {
    return undefined;
  }
  if (env === process.env) {
    return env.AI_GATEWAY_API_KEY === bootGatewayApiKey
      ? bootGatewayApiKey
      : undefined;
  }
  return env.AI_GATEWAY_API_KEY;
}

/**
 * Resolve the AI Gateway credential for a harness run and write it into the
 * environment (harness adapters and the sandbox network policy read it from
 * there). Without a static key, a fresh OIDC token is minted on every call —
 * warm server instances outlive a stored token's expiry, so a cached token
 * must never be reused.
 */
export async function ensureGatewayApiKeyEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  const staticKey = staticGatewayApiKeyFor(env);
  if (staticKey) {
    return staticKey;
  }

  const token = await getVercelOidcToken().catch(() => undefined);
  if (token) {
    env.VERCEL_OIDC_TOKEN = token;
    env.AI_GATEWAY_API_KEY = token;
    return token;
  }

  const fallback = resolveGatewayApiKey(env);
  if (fallback) {
    env.AI_GATEWAY_API_KEY ??= fallback;
  }
  return fallback;
}
