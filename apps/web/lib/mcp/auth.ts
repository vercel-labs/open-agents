import type { MCPConnection } from "@/lib/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import { discoverOAuthMetadata, refreshOAuthTokens } from "./oauth";

export interface MCPAuthHeaders {
  headers: Record<string, string>;
}

export class MCPAuthError extends Error {
  constructor(
    public connectionId: string,
    message: string,
  ) {
    super(message);
    this.name = "MCPAuthError";
  }
}

/**
 * Resolve auth headers for an MCP connection.
 * For OAuth connections, handles token refresh transparently.
 */
export async function resolveAuthHeaders(
  connection: MCPConnection,
  onTokenRefreshed?: (update: {
    accessToken: string;
    refreshToken: string | null;
    tokenExpiresAt: Date | null;
  }) => Promise<void>,
): Promise<MCPAuthHeaders> {
  switch (connection.authType) {
    case "none":
      return { headers: {} };

    case "bearer": {
      if (!connection.accessToken) {
        return { headers: {} };
      }
      return {
        headers: {
          Authorization: `Bearer ${decrypt(connection.accessToken)}`,
        },
      };
    }

    case "headers": {
      if (!connection.customHeaders) {
        return { headers: {} };
      }
      const decrypted: Record<string, string> = {};
      for (const [key, value] of Object.entries(connection.customHeaders)) {
        decrypted[key] = decrypt(value);
      }
      return { headers: decrypted };
    }

    case "oauth": {
      if (!connection.accessToken) {
        throw new MCPAuthError(
          connection.id,
          "OAuth access token missing — re-authorize the connection",
        );
      }

      // Check if token is expired (5-minute buffer)
      const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
      const needsRefresh =
        connection.tokenExpiresAt &&
        connection.tokenExpiresAt.getTime() <
          Date.now() + TOKEN_REFRESH_BUFFER_MS;

      if (needsRefresh && connection.refreshToken && connection.oauthClientId) {
        try {
          const metadata = await discoverOAuthMetadata(connection.url);
          const refreshed = await refreshOAuthTokens({
            tokenEndpoint: metadata.token_endpoint,
            refreshToken: decrypt(connection.refreshToken),
            clientId: connection.oauthClientId,
            clientSecret: connection.oauthClientSecret
              ? decrypt(connection.oauthClientSecret)
              : undefined,
          });

          const newAccessToken = encrypt(refreshed.access_token);
          const newRefreshToken = refreshed.refresh_token
            ? encrypt(refreshed.refresh_token)
            : null;
          const newExpiresAt = refreshed.expires_in
            ? new Date(Date.now() + refreshed.expires_in * 1000)
            : null;

          // Notify caller to persist new tokens
          if (onTokenRefreshed) {
            await onTokenRefreshed({
              accessToken: newAccessToken,
              refreshToken: newRefreshToken,
              tokenExpiresAt: newExpiresAt,
            });
          }

          return {
            headers: {
              Authorization: `Bearer ${refreshed.access_token}`,
            },
          };
        } catch (error) {
          console.error(
            `Failed to refresh OAuth token for MCP "${connection.name}":`,
            error,
          );
          throw new MCPAuthError(
            connection.id,
            "OAuth token refresh failed — re-authorize the connection",
          );
        }
      }

      return {
        headers: {
          Authorization: `Bearer ${decrypt(connection.accessToken)}`,
        },
      };
    }

    default:
      return { headers: {} };
  }
}
