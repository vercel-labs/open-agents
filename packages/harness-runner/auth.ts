import { getVercelOidcToken } from "@vercel/oidc";

/**
 * The last OIDC token this module minted and wrote into the environment.
 * Anything else in AI_GATEWAY_API_KEY is a caller/deployment-configured
 * static key. Minted tokens expire, so they must never short-circuit a
 * refresh or be reused after a refresh failure.
 */
let lastMintedToken: string | undefined;

export function resolveGatewayApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN || undefined;
}

function staticGatewayApiKeyFor(env: NodeJS.ProcessEnv): string | undefined {
  const key = env.AI_GATEWAY_API_KEY;
  if (!key || key === lastMintedToken) {
    return undefined;
  }
  return key;
}

/**
 * Resolve the AI Gateway credential for a harness run and write it into the
 * environment, where the harness adapters read it. It is also returned so the
 * caller can hand it to its own sandbox connect: brokering the credential
 * through the sandbox network policy is opt-in per connect and reads nothing
 * from the environment (see `packages/sandbox/vercel/sandbox.ts`).
 *
 * Without a static key, a fresh OIDC token is minted on every call — warm
 * server instances outlive a stored token's expiry, so a cached token must
 * never be reused.
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
    lastMintedToken = token;
    env.VERCEL_OIDC_TOKEN = token;
    env.AI_GATEWAY_API_KEY = token;
    return token;
  }

  const fallback = resolveGatewayApiKey(env);
  if (!fallback) {
    return undefined;
  }
  if (fallback === lastMintedToken) {
    // Honor the invariant above: after a failed refresh, the only available
    // credential is a previously minted (possibly expired) token. Reusing it
    // would produce confusing downstream auth failures, so refuse loudly.
    console.error(
      "[harness-runner] AI Gateway token refresh failed and only a previously minted (possibly expired) OIDC token is available; refusing to reuse it.",
    );
    return undefined;
  }

  env.AI_GATEWAY_API_KEY ??= fallback;
  return fallback;
}
