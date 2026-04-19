import { getServerSession } from "@/lib/session/get-server-session";
import { listVercelTeams } from "@/lib/vercel/teams";
import { getUserVercelToken } from "@/lib/vercel/token";

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const token = await getUserVercelToken(session.user.id);
  if (!token) {
    return Response.json(
      { error: "Vercel token unavailable" },
      { status: 403 },
    );
  }

  try {
    const teams = await listVercelTeams(token);
    return Response.json({ teams });
  } catch (error) {
    console.error("Failed to list Vercel teams:", error);
    return Response.json(
      { error: "Failed to list Vercel teams" },
      { status: 500 },
    );
  }
}
