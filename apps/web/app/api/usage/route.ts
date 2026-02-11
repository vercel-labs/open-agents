import type { NextRequest } from "next/server";
import { verifyAccessToken } from "@/lib/db/cli-tokens";
import { getUsageHistory, recordUsage } from "@/lib/db/usage";
import { getSessionFromReq } from "@/lib/session/server";

/**
 * POST /api/usage — Record usage from CLI clients (Bearer token auth)
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return Response.json(
      { error: "Missing or invalid authorization header" },
      { status: 401 },
    );
  }

  const token = authHeader.slice(7);
  let verification: Awaited<ReturnType<typeof verifyAccessToken>>;
  try {
    verification = await verifyAccessToken(token);
  } catch {
    return Response.json(
      { error: "Token verification failed" },
      { status: 500 },
    );
  }

  if (!verification.valid || !verification.userId) {
    return Response.json(
      { error: verification.error ?? "Invalid token" },
      { status: 401 },
    );
  }

  let body: {
    messages: unknown[];
    usage: {
      inputTokens: number;
      cachedInputTokens?: number;
      outputTokens: number;
    };
    modelId?: string;
    agentType?: "main" | "subagent";
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    await recordUsage(verification.userId, {
      source: "cli",
      agentType: body.agentType ?? "main",
      model: body.modelId ?? "unknown/unknown",
      messages: (body.messages ?? []) as Parameters<
        typeof recordUsage
      >[1]["messages"],
      usage: {
        inputTokens: body.usage?.inputTokens ?? 0,
        cachedInputTokens: body.usage?.cachedInputTokens ?? 0,
        outputTokens: body.usage?.outputTokens ?? 0,
      },
    });
  } catch (error) {
    console.error("Failed to record usage:", error);
    return Response.json({ error: "Failed to record usage" }, { status: 500 });
  }

  return Response.json({ success: true });
}

/**
 * GET /api/usage — Retrieve aggregated daily usage history (cookie auth)
 */
export async function GET(req: NextRequest) {
  const session = await getSessionFromReq(req);
  if (!session?.user?.id) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const usage = await getUsageHistory(session.user.id);
    return Response.json({ usage });
  } catch (error) {
    console.error("Failed to get usage history:", error);
    return Response.json(
      { error: "Failed to get usage history" },
      { status: 500 },
    );
  }
}
