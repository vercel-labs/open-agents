import { getRun } from "workflow/api";
import {
  requireAuthenticatedUser,
  requireOwnedChatById,
} from "@/app/api/chat/_lib/chat-context";
import type { WebAgentUIMessage } from "@/app/types";
import {
  compareAndSetChatActiveStreamId,
  createChatMessageIfNotExists,
  updateChatAssistantActivity,
} from "@/lib/db/sessions";

type RouteContext = {
  params: Promise<{ chatId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { chatId } = await context.params;

  const chatContext = await requireOwnedChatById({
    userId: authResult.userId,
    chatId,
  });
  if (!chatContext.ok) {
    return chatContext.response;
  }

  const { chat } = chatContext;

  if (!chat.activeStreamId) {
    return Response.json({ success: true });
  }

  // Persist the latest client-side assistant message snapshot before
  // cancelling so mid-step output is not lost on abrupt stop.
  try {
    const body: unknown = await request.json().catch(() => null);
    if (isStopRequestWithMessage(body)) {
      await persistAssistantSnapshot(chatId, body.assistantMessage);
    }
  } catch {
    // Best-effort — don't block cancellation if persistence fails.
  }

  let cancelFailed = false;
  try {
    const run = getRun(chat.activeStreamId);
    await run.cancel();
  } catch (error) {
    cancelFailed = true;
    console.error(
      `[workflow] Failed to cancel workflow run for chat ${chatId}:`,
      error,
    );
  }

  if (cancelFailed && (await isRunStillLive(chat.activeStreamId))) {
    // The run is verifiably still executing. Keep activeStreamId so a
    // follow-up prompt cannot start a second workflow against the same
    // chat and sandbox.
    return Response.json(
      { error: "Failed to cancel workflow run" },
      { status: 500 },
    );
  }

  // Clear activeStreamId immediately so a follow-up prompt does not
  // reconnect to the cancelled (but not yet terminal) workflow. When
  // cancellation failed, this branch is only reached for runs that are
  // terminal or unreachable (e.g. old deployment-pinned runs that can no
  // longer be cancelled) — those should not keep the chat stuck.
  // Uses CAS to avoid clobbering a newer workflow that raced in.
  await compareAndSetChatActiveStreamId(
    chatId,
    chat.activeStreamId,
    null,
  ).catch((err: unknown) => {
    console.error(
      `[workflow] Failed to clear activeStreamId for chat ${chatId}:`,
      err,
    );
  });

  return Response.json({
    success: true,
    ...(cancelFailed ? { warning: "Failed to cancel workflow run" } : {}),
  });
}

async function isRunStillLive(runId: string): Promise<boolean> {
  try {
    const status = await getRun(runId).status;
    return status === "pending" || status === "running";
  } catch {
    // Status is unreachable (e.g. the run belongs to a torn-down
    // deployment). Treat as not live so the chat does not stay stuck.
    return false;
  }
}

async function persistAssistantSnapshot(
  chatId: string,
  message: WebAgentUIMessage,
): Promise<void> {
  // Insert-only: if the workflow already persisted a fuller message, this
  // is a no-op. Avoids overwriting server-side content with a stale
  // (throttled) client snapshot.
  const created = await createChatMessageIfNotExists({
    id: message.id,
    chatId,
    role: "assistant",
    parts: message,
  });
  if (created) {
    await updateChatAssistantActivity(chatId, new Date());
  }
}

function isStopRequestWithMessage(
  value: unknown,
): value is { assistantMessage: WebAgentUIMessage } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (!("assistantMessage" in value) || !value.assistantMessage) {
    return false;
  }
  const msg = value.assistantMessage;
  return (
    typeof msg === "object" &&
    msg !== null &&
    "id" in msg &&
    typeof msg.id === "string" &&
    "role" in msg &&
    msg.role === "assistant" &&
    "parts" in msg &&
    Array.isArray(msg.parts)
  );
}
