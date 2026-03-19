import type { NextRequest } from "next/server";
import { getUsageInsights } from "@/lib/db/usage-insights";
import { getUsageHistory } from "@/lib/db/usage";
import { getSessionFromReq } from "@/lib/session/server";

/**
 * GET /api/usage — Retrieve aggregated daily usage history (cookie auth)
 */
export async function GET(req: NextRequest) {
  const session = await getSessionFromReq(req);
  if (!session?.user?.id) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const [usage, insights] = await Promise.all([
      getUsageHistory(session.user.id),
      getUsageInsights(session.user.id),
    ]);
    return Response.json({ usage, insights });
  } catch (error) {
    console.error("Failed to get usage history:", error);
    return Response.json(
      { error: "Failed to get usage history" },
      { status: 500 },
    );
  }
}
