import type { UIMessage } from "ai";
import type { NextRequest } from "next/server";
import { verifyAccessToken } from "@/lib/db/cli-tokens";
import { getUsageHistory, recordUsage } from "@/lib/db/usage";
import { getSessionFromReq } from "@/lib/session/server";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUiMessageLike(value: unknown): value is UIMessage {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.role !== "string") {
    return false;
  }
  return Array.isArray(value.parts);
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsedBody = isRecord(body) ? body : {};
  const rawMessages = Array.isArray(parsedBody.messages)
    ? parsedBody.messages
    : [];
  const messages = rawMessages.filter(isUiMessageLike);
  const usage = isRecord(parsedBody.usage) ? parsedBody.usage : {};
  const inputTokens = parseNumber(usage.inputTokens) ?? 0;
  const cachedInputTokens = parseNumber(usage.cachedInputTokens) ?? 0;
  const outputTokens = parseNumber(usage.outputTokens) ?? 0;
  const modelId =
    typeof parsedBody.modelId === "string"
      ? parsedBody.modelId
      : "unknown/unknown";
  const agentType =
    parsedBody.agentType === "subagent" || parsedBody.agentType === "main"
      ? parsedBody.agentType
      : "main";

  try {
    await recordUsage(verification.userId, {
      source: "cli",
      agentType,
      model: modelId,
      messages,
      usage: {
        inputTokens,
        cachedInputTokens,
        outputTokens,
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
