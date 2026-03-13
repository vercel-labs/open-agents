import type { WebAgentUIMessage } from "@/app/types";
import { getChatById, getSessionById, updateSession } from "@/lib/db/sessions";
import { buildActiveLifecycleUpdate } from "@/lib/sandbox/lifecycle";
import { isSandboxActive } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";
import type { ChatCompactionContextPayload, ChatRequestBody } from "./types";

export type ChatSessionRecord = NonNullable<
  Awaited<ReturnType<typeof getSessionById>>
>;

export type ChatRecord = NonNullable<Awaited<ReturnType<typeof getChatById>>>;

export type ActiveChatSessionRecord = ChatSessionRecord & {
  sandboxState: NonNullable<ChatSessionRecord["sandboxState"]>;
};

export interface PreparedChatRequestContext {
  userId: string;
  messages: WebAgentUIMessage[];
  sessionId: string;
  chatId: string;
  requestedCompactionContext?: ChatCompactionContextPayload;
  sessionRecord: ActiveChatSessionRecord;
  chat: ChatRecord;
  requestStartedAt: Date;
  requestStartedAtMs: number;
}

type RequestPreparationResult =
  | { ok: true; context: PreparedChatRequestContext }
  | { ok: false; response: Response };

export async function prepareChatRequestContext(
  req: Request,
): Promise<RequestPreparationResult> {
  const session = await getServerSession();
  if (!session?.user) {
    return {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
  }

  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return {
      ok: false,
      response: Response.json({ error: "Invalid JSON body" }, { status: 400 }),
    };
  }

  const {
    messages,
    sessionId,
    chatId,
    context: requestedCompactionContext,
  } = body;

  if (!sessionId || !chatId) {
    return {
      ok: false,
      response: Response.json(
        { error: "sessionId and chatId are required" },
        { status: 400 },
      ),
    };
  }

  const [sessionRecord, chat] = await Promise.all([
    getSessionById(sessionId),
    getChatById(chatId),
  ]);

  if (!sessionRecord) {
    return {
      ok: false,
      response: Response.json({ error: "Session not found" }, { status: 404 }),
    };
  }

  if (sessionRecord.userId !== session.user.id) {
    return {
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 403 }),
    };
  }

  if (!chat || chat.sessionId !== sessionId) {
    return {
      ok: false,
      response: Response.json({ error: "Chat not found" }, { status: 404 }),
    };
  }

  if (!isSandboxActive(sessionRecord.sandboxState)) {
    return {
      ok: false,
      response: Response.json(
        { error: "Sandbox not initialized" },
        { status: 400 },
      ),
    };
  }

  const activeSessionRecord = sessionRecord as ActiveChatSessionRecord;

  const requestStartedAt = new Date();
  const requestStartedAtMs = requestStartedAt.getTime();

  await updateSession(sessionId, {
    ...buildActiveLifecycleUpdate(activeSessionRecord.sandboxState, {
      activityAt: requestStartedAt,
    }),
  });

  return {
    ok: true,
    context: {
      userId: session.user.id,
      messages,
      sessionId,
      chatId,
      requestedCompactionContext,
      sessionRecord: activeSessionRecord,
      chat,
      requestStartedAt,
      requestStartedAtMs,
    },
  };
}
