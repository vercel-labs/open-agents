import { nanoid } from "nanoid";
import {
  createChat,
  getChatById,
  getChatSummariesBySessionId,
  getSessionById,
} from "@/lib/db/sessions";
import { getUserPreferences } from "@/lib/db/user-preferences";
import { getServerSession } from "@/lib/session/get-server-session";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(_req: Request, context: RouteContext) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { sessionId } = await context.params;
  const sessionRecord = await getSessionById(sessionId);
  if (!sessionRecord) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  if (sessionRecord.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const [chats, preferences] = await Promise.all([
    getChatSummariesBySessionId(sessionId, session.user.id),
    getUserPreferences(session.user.id),
  ]);
  return Response.json({ chats, defaultModelId: preferences.defaultModelId });
}

export async function POST(req: Request, context: RouteContext) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { sessionId } = await context.params;
  const sessionRecord = await getSessionById(sessionId);
  if (!sessionRecord) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  if (sessionRecord.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
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

  const preferences = await getUserPreferences(session.user.id);
  const chat = await createChat({
    id: requestedChatId ?? nanoid(),
    sessionId,
    title: "New chat",
    modelId: preferences.defaultModelId,
  });

  return Response.json({ chat });
}
