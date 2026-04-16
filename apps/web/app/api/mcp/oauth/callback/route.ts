import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/session/get-server-session";
import {
  consumeOAuthState,
  updateMCPConnectionTokens,
  updateMCPConnection,
  getMCPConnectionById,
} from "@/lib/db/mcp-connections";
import { discoverOAuthMetadata, exchangeCodeForTokens } from "@/lib/mcp/oauth";
import { encrypt, decrypt } from "@/lib/crypto";

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  const userId = session.user.id;
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const redirectBase = new URL("/settings/connections", req.url);

  if (error) {
    redirectBase.searchParams.set("mcp_error", error);
    return NextResponse.redirect(redirectBase);
  }

  if (!code || !state) {
    redirectBase.searchParams.set("mcp_error", "missing_params");
    return NextResponse.redirect(redirectBase);
  }

  // Validate state
  const oauthState = await consumeOAuthState(state);
  if (!oauthState || oauthState.userId !== userId) {
    redirectBase.searchParams.set("mcp_error", "invalid_state");
    return NextResponse.redirect(redirectBase);
  }

  // Get the connection
  const connection = oauthState.connectionId
    ? await getMCPConnectionById(oauthState.connectionId, userId)
    : null;

  if (!connection) {
    redirectBase.searchParams.set("mcp_error", "connection_not_found");
    return NextResponse.redirect(redirectBase);
  }

  try {
    // Discover token endpoint
    const metadata = await discoverOAuthMetadata(connection.url);
    const redirectUri = `${req.nextUrl.origin}/api/mcp/oauth/callback`;

    const clientId = oauthState.oauthClientId ?? connection.oauthClientId;
    const clientSecret = oauthState.oauthClientSecret
      ? decrypt(oauthState.oauthClientSecret)
      : connection.oauthClientSecret
        ? decrypt(connection.oauthClientSecret)
        : undefined;

    if (!clientId) {
      redirectBase.searchParams.set("mcp_error", "missing_client_id");
      return NextResponse.redirect(redirectBase);
    }

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens({
      tokenEndpoint: metadata.token_endpoint,
      code,
      codeVerifier: decrypt(oauthState.codeVerifier),
      redirectUri,
      clientId,
      clientSecret,
    });

    // Store encrypted tokens
    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null;

    await updateMCPConnectionTokens(connection.id, userId, {
      accessToken: encrypt(tokens.access_token),
      refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
      tokenExpiresAt: expiresAt,
    });

    // Also store scopes if provided
    if (tokens.scope) {
      await updateMCPConnection(connection.id, userId, {
        oauthScopes: tokens.scope,
      });
    }

    redirectBase.searchParams.set("mcp_connected", connection.provider);
    return NextResponse.redirect(redirectBase);
  } catch (err) {
    console.error("MCP OAuth callback error:", err);
    redirectBase.searchParams.set("mcp_error", "token_exchange_failed");
    return NextResponse.redirect(redirectBase);
  }
}
