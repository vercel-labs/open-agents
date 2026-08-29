import {
  requireAuthenticatedUser,
  requireOwnedSessionChat,
} from "@/app/api/sessions/_lib/session-context";
import type { WebAgentUIMessage } from "@/app/types";
import {
  deleteChat,
  getChatMessages,
  getChatsBySessionId,
  updateEmptyChat,
  updateChat,
} from "@/lib/db/sessions";
import type { ChatHarnessId } from "@/lib/chat-harnesses";
import { getUserPreferences } from "@/lib/db/user-preferences";
import { sanitizeSelectedModelIdForSession } from "@/lib/model-access";
import { getAllVariants } from "@/lib/model-variants";
import { getServerSession } from "@/lib/session/get-server-session";
import { resolveHarnessSwitch } from "./harness-switch";

type RouteContext = {
  params: Promise<{ sessionId: string; chatId: string }>;
};

interface UpdateChatRequest {
  title?: string;
  modelId?: string;
  harnessId?: string;
}

export interface ChatRefreshResponse {
  chat: {
    id: string;
    modelId: string | null;
    harnessId: ChatHarnessId;
    activeStreamId: string | null;
  };
  isStreaming: boolean;
  messages: WebAgentUIMessage[];
}

export async function GET(req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const session = await getServerSession();
  const { sessionId, chatId } = await context.params;

  const chatContext = await requireOwnedSessionChat({
    userId: authResult.userId,
    sessionId,
    chatId,
  });
  if (!chatContext.ok) {
    return chatContext.response;
  }

  const [messages, preferences] = await Promise.all([
    getChatMessages(chatId),
    getUserPreferences(authResult.userId),
  ]);
  const modelId =
    sanitizeSelectedModelIdForSession(
      chatContext.chat.modelId,
      getAllVariants(preferences.modelVariants),
      session,
      req.url,
    ) ??
    chatContext.chat.modelId ??
    null;

  return Response.json({
    chat: {
      id: chatContext.chat.id,
      modelId,
      harnessId: chatContext.chat.harnessId,
      activeStreamId: chatContext.chat.activeStreamId,
    },
    isStreaming: chatContext.chat.activeStreamId !== null,
    messages: messages.map((message) => message.parts as WebAgentUIMessage),
  } satisfies ChatRefreshResponse);
}

export async function PATCH(req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const session = await getServerSession();
  const { sessionId, chatId } = await context.params;

  const chatContext = await requireOwnedSessionChat({
    userId: authResult.userId,
    sessionId,
    chatId,
  });
  if (!chatContext.ok) {
    return chatContext.response;
  }

  let body: UpdateChatRequest;
  try {
    body = (await req.json()) as UpdateChatRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const nextTitle = body.title?.trim();
  const nextModelId = body.modelId?.trim();
  const nextHarnessId = body.harnessId?.trim();

  if (!nextTitle && !nextModelId && !nextHarnessId) {
    return Response.json(
      { error: "At least one field is required" },
      { status: 400 },
    );
  }

  const updatePayload: {
    title?: string;
    modelId?: string;
    harnessId?: ChatHarnessId;
  } = {};
  if (nextTitle) {
    updatePayload.title = nextTitle;
  }
  if (nextModelId) {
    const preferences = await getUserPreferences(authResult.userId);
    const sanitizedModelId = sanitizeSelectedModelIdForSession(
      nextModelId,
      getAllVariants(preferences.modelVariants),
      session,
      req.url,
    );
    updatePayload.modelId = sanitizedModelId ?? nextModelId;
  }

  let changesHarness = false;
  if (nextHarnessId) {
    const switchResult = resolveHarnessSwitch({
      requestedHarnessId: nextHarnessId,
      currentHarnessId: chatContext.chat.harnessId,
      currentModelId: chatContext.chat.modelId,
      hasExplicitModelUpdate: updatePayload.modelId !== undefined,
    });
    if (!switchResult.ok) {
      return switchResult.response;
    }

    const { harnessSwitch } = switchResult;
    changesHarness = harnessSwitch.changesHarness;
    updatePayload.harnessId = harnessSwitch.harnessId;
    if (harnessSwitch.coercedModelId !== undefined) {
      updatePayload.modelId = harnessSwitch.coercedModelId;
    }
  }

  const updatedChat = changesHarness
    ? await updateEmptyChat(chatId, updatePayload)
    : await updateChat(chatId, updatePayload);
  if (!updatedChat) {
    if (changesHarness) {
      return Response.json(
        { error: "Harness cannot be changed after the first message" },
        { status: 409 },
      );
    }

    return Response.json({ error: "Chat not found" }, { status: 404 });
  }

  const preferences = await getUserPreferences(authResult.userId);
  return Response.json({
    chat: {
      ...updatedChat,
      modelId:
        sanitizeSelectedModelIdForSession(
          updatedChat.modelId,
          getAllVariants(preferences.modelVariants),
          session,
          req.url,
        ) ?? updatedChat.modelId,
    },
  });
}

export async function DELETE(_req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId, chatId } = await context.params;

  const chatContext = await requireOwnedSessionChat({
    userId: authResult.userId,
    sessionId,
    chatId,
  });
  if (!chatContext.ok) {
    return chatContext.response;
  }

  const chats = await getChatsBySessionId(sessionId);
  if (chats.length <= 1) {
    return Response.json(
      { error: "Cannot delete the only chat in a session" },
      { status: 400 },
    );
  }

  await deleteChat(chatId);
  return Response.json({ success: true });
}
