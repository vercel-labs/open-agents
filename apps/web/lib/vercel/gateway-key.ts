import "server-only";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { decrypt, encrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { vercelConnections } from "@/lib/db/schema";
import {
  VercelApiError,
  fetchVercelApi,
  isAuthenticationError,
} from "./api-client";
import { getUserVercelToken } from "./token";

/** How long before we proactively refresh the gateway key (4 hours). */
const GATEWAY_KEY_MAX_AGE_MS = 4 * 60 * 60 * 1000;

interface ExchangeApiKeyResponse {
  apiKeyString?: string;
  apiKey?: {
    id?: string;
  };
}

/**
 * Exchange a Vercel access token for a team-scoped AI Gateway API key.
 *
 * This calls `POST /api-keys?teamId={teamId}` with `purpose: "ai-gateway"`
 * to create a key that bills usage to the specified team.
 */
async function exchangeTokenForGatewayKey(params: {
  token: string;
  teamId: string;
  userName?: string;
}): Promise<{ apiKeyString: string; apiKeyId: string | null }> {
  const keyName = params.userName
    ? `${params.userName} - Open Agents`
    : "Open Agents";

  const response = await fetchVercelApi<ExchangeApiKeyResponse>({
    method: "POST",
    path: "/api-keys",
    token: params.token,
    query: new URLSearchParams({ teamId: params.teamId }),
    body: {
      purpose: "ai-gateway",
      name: keyName,
    },
  });

  if (!response.apiKeyString) {
    throw new Error("Vercel API did not return an API key");
  }

  return {
    apiKeyString: response.apiKeyString,
    apiKeyId: response.apiKey?.id ?? null,
  };
}

/**
 * Revoke a previously-created AI Gateway API key.
 * Best-effort — failures are logged but don't block the caller.
 */
async function revokeGatewayApiKey(params: {
  token: string;
  teamId: string;
  apiKeyId: string;
}): Promise<void> {
  try {
    await fetchVercelApi({
      method: "DELETE",
      path: `/api-keys/${encodeURIComponent(params.apiKeyId)}`,
      token: params.token,
      query: new URLSearchParams({ teamId: params.teamId }),
    });
  } catch (error) {
    // Best-effort cleanup — log and continue
    console.warn("[gateway-key] Failed to revoke old API key:", {
      apiKeyId: params.apiKeyId,
      teamId: params.teamId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Obtain (or refresh) a gateway API key for the user's selected team.
 * Revokes the previous key if switching teams, then stores the new
 * encrypted key in the `vercel_connections` table.
 *
 * Returns the plaintext API key or null if the exchange failed.
 */
export async function obtainGatewayApiKey(params: {
  userId: string;
  teamId: string;
  teamSlug?: string | null;
  userName?: string;
}): Promise<string | null> {
  const token = await getUserVercelToken(params.userId);
  if (!token) {
    return null;
  }

  try {
    // Skip if the same team is already configured with a valid key
    const [existing] = await db
      .select({
        gatewayApiKeyId: vercelConnections.gatewayApiKeyId,
        gatewayApiKey: vercelConnections.gatewayApiKey,
        teamId: vercelConnections.teamId,
      })
      .from(vercelConnections)
      .where(eq(vercelConnections.userId, params.userId))
      .limit(1);

    if (
      existing?.teamId === params.teamId &&
      existing.gatewayApiKey &&
      existing.gatewayApiKeyId
    ) {
      // Same team, key already exists — return the existing key
      try {
        return decrypt(existing.gatewayApiKey);
      } catch {
        // Decryption failed — fall through to re-create
      }
    }

    // Revoke the old key if switching teams
    if (existing?.gatewayApiKeyId && existing.teamId) {
      await revokeGatewayApiKey({
        token,
        teamId: existing.teamId,
        apiKeyId: existing.gatewayApiKeyId,
      });
    }

    // Create a new key for the selected team
    const { apiKeyString, apiKeyId } = await exchangeTokenForGatewayKey({
      token,
      teamId: params.teamId,
      userName: params.userName,
    });

    // Upsert the vercel_connections row
    const now = new Date();
    await db
      .insert(vercelConnections)
      .values({
        id: nanoid(),
        userId: params.userId,
        teamId: params.teamId,
        teamSlug: params.teamSlug ?? null,
        gatewayApiKey: encrypt(apiKeyString),
        gatewayApiKeyId: apiKeyId,
        gatewayApiKeyObtainedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: vercelConnections.userId,
        set: {
          teamId: params.teamId,
          teamSlug: params.teamSlug ?? null,
          gatewayApiKey: encrypt(apiKeyString),
          gatewayApiKeyId: apiKeyId,
          gatewayApiKeyObtainedAt: now,
          updatedAt: now,
        },
      });

    return apiKeyString;
  } catch (error) {
    console.error("[gateway-key] Failed to exchange token for gateway key:", {
      error: error instanceof Error ? error.message : String(error),
      responseBody:
        error instanceof VercelApiError ? error.responseBody : undefined,
      teamId: params.teamId,
      isAuthError: isAuthenticationError(error),
    });
    return null;
  }
}

/**
 * Get the user's current gateway API key, refreshing if stale.
 *
 * Returns `{ apiKey, teamId }` or null if no gateway key is configured.
 */
export async function getUserGatewayConfig(
  userId: string,
): Promise<{ apiKey: string; teamId: string } | null> {
  const [row] = await db
    .select({
      gatewayApiKey: vercelConnections.gatewayApiKey,
      gatewayApiKeyObtainedAt: vercelConnections.gatewayApiKeyObtainedAt,
      teamId: vercelConnections.teamId,
    })
    .from(vercelConnections)
    .where(eq(vercelConnections.userId, userId))
    .limit(1);

  if (!row?.gatewayApiKey || !row?.teamId) {
    return null;
  }

  // Check if key needs proactive refresh
  const needsRefresh =
    !row.gatewayApiKeyObtainedAt ||
    Date.now() - row.gatewayApiKeyObtainedAt.getTime() > GATEWAY_KEY_MAX_AGE_MS;

  if (needsRefresh) {
    const freshKey = await obtainGatewayApiKey({
      userId,
      teamId: row.teamId,
    });

    if (freshKey) {
      return { apiKey: freshKey, teamId: row.teamId };
    }

    // Fall through to use the existing key if refresh failed
  }

  try {
    return {
      apiKey: decrypt(row.gatewayApiKey),
      teamId: row.teamId,
    };
  } catch {
    return null;
  }
}

/**
 * Clear the user's gateway API key and team selection.
 * Revokes the key in Vercel before deleting the local record.
 */
export async function clearGatewayConfig(userId: string): Promise<void> {
  const token = await getUserVercelToken(userId);

  // Revoke the key in Vercel if possible
  if (token) {
    const [existing] = await db
      .select({
        gatewayApiKeyId: vercelConnections.gatewayApiKeyId,
        teamId: vercelConnections.teamId,
      })
      .from(vercelConnections)
      .where(eq(vercelConnections.userId, userId))
      .limit(1);

    if (existing?.gatewayApiKeyId && existing.teamId) {
      await revokeGatewayApiKey({
        token,
        teamId: existing.teamId,
        apiKeyId: existing.gatewayApiKeyId,
      });
    }
  }

  await db
    .delete(vercelConnections)
    .where(eq(vercelConnections.userId, userId));
}
