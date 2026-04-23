import { NextResponse, type NextRequest } from "next/server";
import { createMCPClient } from "@ai-sdk/mcp";
import { getServerSession } from "@/lib/session/get-server-session";
import {
  getMCPConnectionById,
  updateMCPConnectionStatus,
} from "@/lib/db/mcp-connections";
import { resolveAuthHeaders } from "@/lib/mcp/auth";
import { assertSafeUrl } from "@/lib/mcp/validate";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const userId = session.user.id;

  const connection = await getMCPConnectionById(id, userId);
  if (!connection) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    assertSafeUrl(connection.url);
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        error: error instanceof Error ? error.message : "Invalid URL",
      },
      { status: 400 },
    );
  }

  try {
    const { headers } = await resolveAuthHeaders(connection);

    const client = await createMCPClient({
      transport: {
        type: connection.transportType as "http" | "sse",
        url: connection.url,
        headers,
      },
    });

    const tools = await client.tools();
    const toolNames = Object.keys(tools);

    await client.close();

    await updateMCPConnectionStatus(id, userId, "active");

    return NextResponse.json({
      status: "ok",
      toolCount: toolNames.length,
      tools: toolNames,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await updateMCPConnectionStatus(id, userId, "error", message);

    return NextResponse.json(
      { status: "error", error: message },
      { status: 502 },
    );
  }
}
