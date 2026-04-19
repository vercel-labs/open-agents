import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { vercelConnections } from "@/lib/db/schema";
import { getServerSession } from "@/lib/session/get-server-session";

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const [row] = await db
    .select({
      gatewayApiKey: vercelConnections.gatewayApiKey,
      teamId: vercelConnections.teamId,
    })
    .from(vercelConnections)
    .where(eq(vercelConnections.userId, session.user.id))
    .limit(1);

  if (!row?.gatewayApiKey) {
    return Response.json(
      { error: "No gateway key configured" },
      { status: 404 },
    );
  }

  try {
    // TODO: remove after debugging credits display
    const apiKey = decrypt(row.gatewayApiKey);
    console.log(
      "[credits] Using key prefix:",
      apiKey.substring(0, 10) + "...",
      "for team:",
      row.teamId,
    );

    const response = await fetch("https://ai-gateway.vercel.sh/v1/credits", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      return Response.json(
        { error: "Failed to fetch credits" },
        { status: response.status },
      );
    }

    const data = (await response.json()) as {
      balance: string;
      total_used: string;
    };

    // TODO: remove after debugging credits display
    console.log("[credits] Raw response:", data);

    return Response.json(data);
  } catch (error) {
    console.error("Failed to fetch gateway credits:", error);
    return Response.json({ error: "Failed to fetch credits" }, { status: 500 });
  }
}
