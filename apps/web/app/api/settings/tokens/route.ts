import { getServerSession } from "@/lib/session/get-server-session";
import { getUserTokens, revokeAllUserTokens } from "@/lib/db/cli-tokens";

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const tokens = await getUserTokens(session.user.id);
  return Response.json({ tokens });
}

export async function DELETE() {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const count = await revokeAllUserTokens(session.user.id);
    return Response.json({ success: true, revokedCount: count });
  } catch (error) {
    console.error("Failed to revoke all tokens:", error);
    return Response.json({ error: "Failed to revoke tokens" }, { status: 500 });
  }
}
