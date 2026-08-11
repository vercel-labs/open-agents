import { nanoid } from "nanoid";
import {
  requireAuthenticatedUser,
  requireOwnedSession,
} from "@/app/api/sessions/_lib/session-context";
import {
  countChatsBySessionId,
  createChat,
  getChatById,
  getChatSummariesBySessionId,
} from "@/lib/db/sessions";
import { MAX_CHATS_PER_SESSION } from "@/lib/sandbox/config";
import { getUserPreferences } from "@/lib/db/user-preferences";
import { sanitizeUserPreferencesForSession } from "@/lib/model-access";
import { getServerSession } from "@/lib/session/get-server-session";
import { DEFAULT_CHAT_HARNESS_ID } from "@/lib/chat-harnesses";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const session = await getServerSession();
  const { sessionId } = await context.params;

  const sessionContext = await requireOwnedSession({
    userId: authResult.userId,
    sessionId,
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const [chats, rawPreferences] = await Promise.all([
    getChatSummariesBySessionId(sessionId, authResult.userId),
    getUserPreferences(authResult.userId),
  ]);
  const preferences = sanitizeUserPreferencesForSession(
    rawPreferences,
    session,
    req.url,
  );
  return Response.json({ chats, defaultModelId: preferences.defaultModelId });
}

export async function POST(req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const session = await getServerSession();
  const { sessionId } = await context.params;

  const sessionContext = await requireOwnedSession({
    userId: authResult.userId,
    sessionId,
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  let requestedChatId: string | null = null;
  try {
    const body = await req.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "id" in body &&
      body.id !== undefined
    ) {
      if (typeof body.id !== "string" || body.id.length === 0) {
        return Response.json({ error: "Invalid chat id" }, { status: 400 });
      }
      requestedChatId = body.id;
    }
  } catch {
    requestedChatId = null;
  }

  if (requestedChatId) {
    const existing = await getChatById(requestedChatId);
    if (existing) {
      if (existing.sessionId !== sessionId) {
        return Response.json({ error: "Chat ID conflict" }, { status: 409 });
      }
      return Response.json({ chat: existing });
    }
  }

  const chatCount = await countChatsBySessionId(sessionId);
  if (chatCount >= MAX_CHATS_PER_SESSION) {
    return Response.json(
      {
        error: `This session already has the maximum of ${MAX_CHATS_PER_SESSION} chats`,
      },
      { status: 400 },
    );
  }

  const preferences = sanitizeUserPreferencesForSession(
    await getUserPreferences(authResult.userId),
    session,
    req.url,
  );
  const chat = await createChat({
    id: requestedChatId ?? nanoid(),
    sessionId,
    title: "New chat",
    modelId: preferences.defaultModelId,
    harnessId: DEFAULT_CHAT_HARNESS_ID,
  });

  return Response.json({ chat });
}
