import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "@/lib/session/get-server-session";
import {
  getMCPConnectionById,
  updateMCPConnection,
  deleteMCPConnection,
} from "@/lib/db/mcp-connections";
import { encrypt } from "@/lib/crypto";
import { validateMcpUrl } from "@/lib/mcp/validate";

export async function PATCH(
  req: NextRequest,
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

  const body = (await req.json()) as {
    name?: string;
    url?: string;
    transportType?: "http" | "sse";
    enabledByDefault?: boolean;
    accessToken?: string;
    customHeaders?: Record<string, string>;
  };

  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.url !== undefined) {
    const urlCheck = validateMcpUrl(body.url);
    if (!urlCheck.valid) {
      return NextResponse.json({ error: urlCheck.error }, { status: 400 });
    }
    update.url = body.url;
  }
  if (body.transportType !== undefined)
    update.transportType = body.transportType;
  if (body.enabledByDefault !== undefined)
    update.enabledByDefault = body.enabledByDefault;
  if (body.accessToken !== undefined) {
    update.accessToken = encrypt(body.accessToken);
    update.status = "active";
  }
  if (body.customHeaders !== undefined) {
    update.customHeaders = Object.fromEntries(
      Object.entries(body.customHeaders).map(([k, v]) => [k, encrypt(v)]),
    );
  }

  await updateMCPConnection(id, userId, update);

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  await deleteMCPConnection(id, session.user.id);

  return NextResponse.json({ ok: true });
}
