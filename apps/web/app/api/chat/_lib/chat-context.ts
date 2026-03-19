import { getChatById, getSessionById } from "@/lib/db/sessions";
import { isSandboxActive } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";

export type ResponseFormat = "json" | "text";

export type SessionRecord = NonNullable<
  Awaited<ReturnType<typeof getSessionById>>
>;
export type ChatRecord = NonNullable<Awaited<ReturnType<typeof getChatById>>>;

type AuthenticatedUserResult =
  | {
      ok: true;
      userId: string;
    }
  | {
      ok: false;
      response: Response;
    };

type OwnedSessionChatResult =
  | {
      ok: true;
      sessionRecord: SessionRecord;
      chat: ChatRecord;
    }
  | {
      ok: false;
      response: Response;
    };

type OwnedChatByIdResult =
  | {
      ok: true;
      sessionRecord: SessionRecord;
      chat: ChatRecord;
    }
  | {
      ok: false;
      response: Response;
    };

interface RequireOwnedSessionChatParams {
  userId: string;
  sessionId: string;
  chatId: string;
  format?: ResponseFormat;
  forbiddenMessage?: string;
  requireActiveSandbox?: boolean;
  sandboxInactiveMessage?: string;
}

interface RequireOwnedChatByIdParams {
  userId: string;
  chatId: string;
  format?: ResponseFormat;
  forbiddenMessage?: string;
}

function toErrorResponse(
  message: string,
  status: number,
  format: ResponseFormat,
): Response {
  if (format === "text") {
    return new Response(message, { status });
  }

  return Response.json({ error: message }, { status });
}

export async function requireAuthenticatedUser(
  format: ResponseFormat = "json",
): Promise<AuthenticatedUserResult> {
  const session = await getServerSession();
  if (!session?.user) {
    return {
      ok: false,
      response: toErrorResponse("Not authenticated", 401, format),
    };
  }

  return {
    ok: true,
    userId: session.user.id,
  };
}

export async function requireOwnedSessionChat(
  params: RequireOwnedSessionChatParams,
): Promise<OwnedSessionChatResult> {
  const {
    userId,
    sessionId,
    chatId,
    format = "json",
    forbiddenMessage = "Forbidden",
    requireActiveSandbox = false,
    sandboxInactiveMessage = "Sandbox not initialized",
  } = params;

  const [sessionRecord, chat] = await Promise.all([
    getSessionById(sessionId),
    getChatById(chatId),
  ]);

  if (!sessionRecord) {
    return {
      ok: false,
      response: toErrorResponse("Session not found", 404, format),
    };
  }

  if (sessionRecord.userId !== userId) {
    return {
      ok: false,
      response: toErrorResponse(forbiddenMessage, 403, format),
    };
  }

  if (!chat || chat.sessionId !== sessionId) {
    return {
      ok: false,
      response: toErrorResponse("Chat not found", 404, format),
    };
  }

  if (requireActiveSandbox && !isSandboxActive(sessionRecord.sandboxState)) {
    return {
      ok: false,
      response: toErrorResponse(sandboxInactiveMessage, 400, format),
    };
  }

  return {
    ok: true,
    sessionRecord,
    chat,
  };
}

export async function requireOwnedChatById(
  params: RequireOwnedChatByIdParams,
): Promise<OwnedChatByIdResult> {
  const {
    userId,
    chatId,
    format = "json",
    forbiddenMessage = "Forbidden",
  } = params;

  const chat = await getChatById(chatId);
  if (!chat) {
    return {
      ok: false,
      response: toErrorResponse("Chat not found", 404, format),
    };
  }

  const sessionRecord = await getSessionById(chat.sessionId);
  if (!sessionRecord || sessionRecord.userId !== userId) {
    return {
      ok: false,
      response: toErrorResponse(forbiddenMessage, 403, format),
    };
  }

  return {
    ok: true,
    sessionRecord,
    chat,
  };
}
