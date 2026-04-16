import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "@/lib/session/get-server-session";
import {
  getUserMCPConnections,
  createMCPConnection,
} from "@/lib/db/mcp-connections";
import { encrypt } from "@/lib/crypto";
import { validateMcpUrl, BLOCKED_HEADER_NAMES } from "@/lib/mcp/validate";

export async function GET() {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connections = await getUserMCPConnections(session.user.id);

  // Strip sensitive fields before returning
  const safe = connections.map((c) => ({
    id: c.id,
    provider: c.provider,
    name: c.name,
    url: c.url,
    transportType: c.transportType,
    authType: c.authType,
    enabledByDefault: c.enabledByDefault,
    status: c.status,
    lastError: c.lastError,
    oauthScopes: c.oauthScopes,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));

  return NextResponse.json(safe);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    provider: string;
    name: string;
    url: string;
    transportType?: "http" | "sse";
    authType: "none" | "bearer" | "headers" | "oauth";
    accessToken?: string;
    customHeaders?: Record<string, string>;
  };

  if (!body.name || !body.url || !body.authType) {
    return NextResponse.json(
      { error: "name, url, and authType are required" },
      { status: 400 },
    );
  }

  // Validate URL is HTTPS and safe (SSRF protection)
  const urlCheck = validateMcpUrl(body.url);
  if (!urlCheck.valid) {
    return NextResponse.json({ error: urlCheck.error }, { status: 400 });
  }

  // Validate custom header keys (prevent request smuggling)
  if (body.customHeaders) {
    for (const key of Object.keys(body.customHeaders)) {
      if (BLOCKED_HEADER_NAMES.has(key.toLowerCase())) {
        return NextResponse.json(
          { error: `Header "${key}" is not allowed` },
          { status: 400 },
        );
      }
    }
  }

  const connection = await createMCPConnection({
    userId: session.user.id,
    provider: body.provider ?? "custom",
    name: body.name,
    url: body.url,
    transportType: body.transportType ?? "http",
    authType: body.authType,
    accessToken: body.accessToken ? encrypt(body.accessToken) : null,
    customHeaders: body.customHeaders
      ? Object.fromEntries(
          Object.entries(body.customHeaders).map(([k, v]) => [k, encrypt(v)]),
        )
      : null,
    status:
      body.authType === "oauth"
        ? "needs_auth"
        : body.accessToken
          ? "active"
          : "unchecked",
    enabledByDefault: true,
  });

  return NextResponse.json(
    {
      id: connection.id,
      provider: connection.provider,
      name: connection.name,
      url: connection.url,
      transportType: connection.transportType,
      authType: connection.authType,
      status: connection.status,
      enabledByDefault: connection.enabledByDefault,
      createdAt: connection.createdAt,
    },
    { status: 201 },
  );
}
