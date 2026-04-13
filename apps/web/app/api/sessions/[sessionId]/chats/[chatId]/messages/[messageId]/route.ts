import { getRun } from "workflow/api";
import {
  requireAuthenticatedUser,
  requireOwnedSessionChat,
} from "@/app/api/sessions/_lib/session-context";
import {
  deleteChatMessageAndFollowing,
  updateChatActiveStreamId,
} from "@/lib/db/sessions";
import {
  isManagedTemplateTrialUser,
  MANAGED_TEMPLATE_TRIAL_DELETE_MESSAGE_ERROR,
} from "@/lib/managed-template-trial";
import { getServerSession } from "@/lib/session/get-server-session";

type RouteContext = {
  params: Promise<{ sessionId: string; chatId: string; messageId: string }>;
};

export async function DELETE(req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const session = await getServerSession();
  const { sessionId, chatId, messageId } = await context.params;

  const chatContext = await requireOwnedSessionChat({
    userId: authResult.userId,
    sessionId,
    chatId,
  });
  if (!chatContext.ok) {
    return chatContext.response;
  }

  if (isManagedTemplateTrialUser(session, req.url)) {
    return Response.json(
      { error: MANAGED_TEMPLATE_TRIAL_DELETE_MESSAGE_ERROR },
      { status: 403 },
    );
  }

  const { chat } = chatContext;

  if (chat.activeStreamId) {
    // Check if the workflow is actually still running. If it terminated
    // without cleaning up (e.g. due to a failure), clear the stale ID
    // and allow the delete to proceed.
    try {
      const run = getRun(chat.activeStreamId);
      const status = await run.status;
      if (status === "running" || status === "pending") {
        return Response.json(
          { error: "Cannot delete messages while a response is streaming" },
          { status: 409 },
        );
      }
    } catch {
      // Workflow run not found — treat as stale.
    }

    // Workflow is terminal or not found — clear the stale activeStreamId.
    await updateChatActiveStreamId(chatId, null);
  }

  const result = await deleteChatMessageAndFollowing(chatId, messageId);

  if (result.status === "not_found") {
    return Response.json({ error: "Message not found" }, { status: 404 });
  }

  if (result.status === "not_user_message") {
    return Response.json(
      { error: "Only user messages can be deleted" },
      { status: 400 },
    );
  }

  return Response.json({
    success: true,
    deletedMessageIds: result.deletedMessageIds,
  });
}
