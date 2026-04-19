import { getServerSession } from "@/lib/session/get-server-session";
import {
  clearGatewayConfig,
  obtainGatewayApiKey,
} from "@/lib/vercel/gateway-key";

/**
 * POST /api/vercel/gateway-key
 *
 * Exchange the user's Vercel token for a team-scoped AI Gateway key.
 * Body: { teamId: string, teamSlug: string }
 */
export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json();
  const teamId = typeof body?.teamId === "string" ? body.teamId.trim() : "";
  const teamSlug =
    typeof body?.teamSlug === "string" ? body.teamSlug.trim() : "";

  if (!teamId) {
    return Response.json({ error: "teamId is required" }, { status: 400 });
  }

  try {
    const apiKey = await obtainGatewayApiKey({
      userId: session.user.id,
      teamId,
      teamSlug: teamSlug || null,
      userName: session.user.name,
    });

    if (!apiKey) {
      return Response.json(
        { error: "Failed to obtain gateway API key for this team" },
        { status: 502 },
      );
    }

    return Response.json({ success: true, teamId, teamSlug });
  } catch (error) {
    console.error("Failed to exchange gateway key:", error);
    return Response.json(
      { error: "Failed to exchange gateway key" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/vercel/gateway-key
 *
 * Clear the user's gateway key and team selection.
 */
export async function DELETE() {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    await clearGatewayConfig(session.user.id);
    return Response.json({ success: true });
  } catch (error) {
    console.error("Failed to clear gateway config:", error);
    return Response.json(
      { error: "Failed to clear gateway config" },
      { status: 500 },
    );
  }
}
