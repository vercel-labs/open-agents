import { NextResponse, type NextRequest } from "next/server";
import { encrypt } from "@/lib/crypto";
import {
  createMCPConnection,
  createOAuthState,
  getMCPConnectionById,
  getUserMCPConnections,
  updateMCPConnection,
} from "@/lib/db/mcp-connections";
import { getCatalogEntry } from "@/lib/mcp/catalog";
import {
  buildAuthorizationUrl,
  discoverOAuthMetadata,
  generatePKCE,
  generateState,
  registerOAuthClient,
} from "@/lib/mcp/oauth";
import { validateMcpUrl } from "@/lib/mcp/validate";
import { getServerSession } from "@/lib/session/get-server-session";

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const body = (await req.json()) as {
    connectionId?: string;
    provider?: string;
    url?: string;
    name?: string;
  };

  let connectionId = body.connectionId;
  let mcpUrl: string;
  let provider: string;
  let connectionName: string;
  let transportType: "http" | "sse" = "http";

  if (connectionId) {
    const connection = await getMCPConnectionById(connectionId, userId);
    if (!connection) {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 },
      );
    }

    if (connection.authType !== "oauth") {
      return NextResponse.json(
        { error: "Connection does not use OAuth" },
        { status: 400 },
      );
    }

    mcpUrl = connection.url;
    provider = connection.provider;
    connectionName = connection.name;
    transportType = connection.transportType;
  } else if (body.provider) {
    const catalogEntry = getCatalogEntry(body.provider);
    if (!catalogEntry) {
      return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
    }

    mcpUrl = catalogEntry.url;
    provider = catalogEntry.provider;
    connectionName = catalogEntry.name;
    transportType = catalogEntry.transportType;

    const existingConnections = await getUserMCPConnections(userId);
    const existingConnection = existingConnections.find(
      (connection) => connection.provider === provider,
    );

    if (existingConnection) {
      if (existingConnection.authType !== "oauth") {
        return NextResponse.json(
          { error: "Connection does not use OAuth" },
          { status: 400 },
        );
      }

      connectionId = existingConnection.id;
      mcpUrl = existingConnection.url;
      provider = existingConnection.provider;
      connectionName = existingConnection.name;
      transportType = existingConnection.transportType;
    }
  } else if (body.url) {
    const urlCheck = validateMcpUrl(body.url);
    if (!urlCheck.valid) {
      return NextResponse.json({ error: urlCheck.error }, { status: 400 });
    }

    mcpUrl = body.url;
    provider = "custom";
    connectionName = body.name ?? "Custom MCP";
  } else {
    return NextResponse.json(
      { error: "Either connectionId, provider, or url is required" },
      { status: 400 },
    );
  }

  const metadata = await discoverOAuthMetadata(mcpUrl);
  const redirectUri = `${req.nextUrl.origin}/api/mcp/oauth/callback`;

  let clientId: string;
  let clientSecret: string | undefined;

  if (!metadata.registration_endpoint) {
    return NextResponse.json(
      { error: "MCP server does not support dynamic client registration" },
      { status: 400 },
    );
  }

  try {
    const registration = await registerOAuthClient(
      metadata.registration_endpoint,
      redirectUri,
    );
    clientId = registration.clientId;
    clientSecret = registration.clientSecret;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Dynamic client registration failed:", errorMessage, error);
    return NextResponse.json(
      {
        error: "OAuth client registration failed with the MCP server",
      },
      { status: 502 },
    );
  }

  if (!connectionId) {
    const connection = await createMCPConnection({
      userId,
      provider,
      name: connectionName,
      url: mcpUrl,
      transportType,
      authType: "oauth",
      status: "needs_auth",
    });
    connectionId = connection.id;
  }

  if (!connectionId) {
    return NextResponse.json(
      { error: "Failed to initialize OAuth connection" },
      { status: 500 },
    );
  }

  await updateMCPConnection(connectionId, userId, {
    oauthClientId: clientId,
    oauthClientSecret: clientSecret ? encrypt(clientSecret) : null,
  });

  const { codeVerifier, codeChallenge } = generatePKCE();
  const state = generateState();

  await createOAuthState({
    state,
    userId,
    connectionId,
    provider,
    codeVerifier: encrypt(codeVerifier),
    redirectTo: "/settings/connections",
    oauthClientId: clientId,
    oauthClientSecret: clientSecret ? encrypt(clientSecret) : null,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });

  const authUrl = buildAuthorizationUrl({
    authorizationEndpoint: metadata.authorization_endpoint,
    clientId,
    redirectUri,
    codeChallenge,
    state,
    scopes: metadata.scopes_supported,
  });

  return NextResponse.json({ authUrl, connectionId });
}
