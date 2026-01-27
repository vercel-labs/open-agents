import { getServerSession } from "@/lib/session/get-server-session";
import { revokeToken, renameToken, getUserTokens } from "@/lib/db/cli-tokens";

interface UpdateTokenRequest {
  deviceName?: string;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  // Verify token belongs to user
  const userTokens = await getUserTokens(session.user.id);
  const tokenBelongsToUser = userTokens.some((t) => t.id === id);
  if (!tokenBelongsToUser) {
    return Response.json({ error: "Token not found" }, { status: 404 });
  }

  let body: UpdateTokenRequest;
  try {
    body = (await req.json()) as UpdateTokenRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.deviceName) {
    return Response.json({ error: "deviceName is required" }, { status: 400 });
  }

  try {
    const success = await renameToken(id, body.deviceName);
    if (!success) {
      return Response.json(
        { error: "Failed to rename token" },
        { status: 500 },
      );
    }
    return Response.json({ success: true });
  } catch (error) {
    console.error("Failed to rename token:", error);
    return Response.json({ error: "Failed to rename token" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  // Verify token belongs to user
  const userTokens = await getUserTokens(session.user.id);
  const tokenBelongsToUser = userTokens.some((t) => t.id === id);
  if (!tokenBelongsToUser) {
    return Response.json({ error: "Token not found" }, { status: 404 });
  }

  try {
    const success = await revokeToken(id);
    if (!success) {
      return Response.json(
        { error: "Failed to revoke token" },
        { status: 500 },
      );
    }
    return Response.json({ success: true });
  } catch (error) {
    console.error("Failed to revoke token:", error);
    return Response.json({ error: "Failed to revoke token" }, { status: 500 });
  }
}
