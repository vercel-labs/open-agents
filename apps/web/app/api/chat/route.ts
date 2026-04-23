import { checkBotId } from "botid/server";
import { createUIMessageStreamResponse, type InferUIMessageChunk } from "ai";
import { botIdConfig } from "@/lib/botid";
import { start } from "workflow/api";
import type { WebAgentUIMessage } from "@/app/types";
import {
  claimChatActiveStreamId,
  compareAndSetChatActiveStreamId,
  countUserMessagesByUserId,
  createChatMessageIfNotExists,
  getChatById,
  getChatMessageById,
  isFirstChatMessage,
  touchChat,
  updateChat,
  updateSession,
} from "@/lib/db/sessions";
import { getUserPreferences } from "@/lib/db/user-preferences";
import {
  filterModelVariantsForSession,
  sanitizeSelectedModelIdForSession,
  sanitizeUserPreferencesForSession,
} from "@/lib/model-access";
import { getAllVariants } from "@/lib/model-variants";
import { createCancelableReadableStream } from "@/lib/chat/create-cancelable-readable-stream";
import { assistantFileLinkPrompt } from "@/lib/assistant-file-links";
import { getServerSession } from "@/lib/session/get-server-session";
import {
  isManagedTemplateTrialUser,
  MANAGED_TEMPLATE_TRIAL_MESSAGE_LIMIT,
  MANAGED_TEMPLATE_TRIAL_MESSAGE_LIMIT_ERROR,
} from "@/lib/managed-template-trial";
import { buildActiveLifecycleUpdate } from "@/lib/sandbox/lifecycle";
import {
  requireAuthenticatedUser,
  requireOwnedSessionChat,
} from "./_lib/chat-context";
import { resolveChatModelSelection } from "./_lib/model-selection";
import { parseChatRequestBody, requireChatIdentifiers } from "./_lib/request";
import { createChatRuntime } from "./_lib/runtime";
import { runAgentWorkflow } from "@/app/workflows/chat";
import { persistAssistantMessagesWithToolResults } from "./_lib/persist-tool-results";

export const maxDuration = 800;

type WebAgentUIMessageChunk = InferUIMessageChunk<WebAgentUIMessage>;

function getLatestUserMessage(messages: WebAgentUIMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") {
      return message;
    }
  }

  return null;
}

export async function POST(req: Request) {
  // 1. Validate session
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }
  const userId = authResult.userId;
  const session = await getServerSession();

  const botVerification = await checkBotId(botIdConfig);
  if (botVerification.isBot) {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }

  const parsedBody = await parseChatRequestBody(req);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  const { messages } = parsedBody.body;

  // 2. Require sessionId and chatId to ensure sandbox ownership verification
  const chatIdentifiers = requireChatIdentifiers(parsedBody.body);
  if (!chatIdentifiers.ok) {
    return chatIdentifiers.response;
  }
  const { sessionId, chatId } = chatIdentifiers;

  // 3. Verify session + chat ownership
  const chatContext = await requireOwnedSessionChat({
    userId,
    sessionId,
    chatId,
    forbiddenMessage: "Unauthorized",
    requireActiveSandbox: true,
    sandboxInactiveMessage: "Sandbox not initialized",
  });
  if (!chatContext.ok) {
    return chatContext.response;
  }

  const { sessionRecord, chat } = chatContext;
  const activeSandboxState = sessionRecord.sandboxState;
  if (!activeSandboxState) {
    throw new Error("Sandbox not initialized");
  }

  if (isManagedTemplateTrialUser(session, req.url)) {
    const latestUserMessage = getLatestUserMessage(messages);
    if (latestUserMessage) {
      const existingMessage = await getChatMessageById(latestUserMessage.id);
      if (!existingMessage) {
        const userMessageCount = await countUserMessagesByUserId(userId);
        if (userMessageCount >= MANAGED_TEMPLATE_TRIAL_MESSAGE_LIMIT) {
          return Response.json(
            { error: MANAGED_TEMPLATE_TRIAL_MESSAGE_LIMIT_ERROR },
            { status: 403 },
          );
        }
      }
    }
  }

  // Guard: if a workflow is already running for this chat, reconnect to it
  // instead of starting a duplicate. This prevents auto-submit from spawning
  // parallel workflows when the client sees completed tool calls mid-loop.
  if (chat.activeStreamId) {
    const existingStreamResolution = await reconcileExistingActiveStream(
      chatId,
      chat.activeStreamId,
    );

    if (existingStreamResolution.action === "resume") {
      return createUIMessageStreamResponse({
        stream: existingStreamResolution.stream,
        headers: { "x-workflow-run-id": existingStreamResolution.runId },
      });
    }

    if (existingStreamResolution.action === "conflict") {
      return Response.json(
        { error: "Another workflow is already running for this chat" },
        { status: 409 },
      );
    }
  }

  const requestStartedAt = new Date();

  // Refresh lifecycle activity so long-running responses don't look idle.
  await updateSession(sessionId, {
    ...buildActiveLifecycleUpdate(sessionRecord.sandboxState, {
      activityAt: requestStartedAt,
    }),
  });

  // Persist the latest user message immediately (fire-and-forget) so it's
  // in the DB before the workflow starts. This ensures a page refresh
  // during workflow queue time still shows the message.
  void persistLatestUserMessage(chatId, messages);

  // Also persist any assistant messages that contain client-side tool results
  // (e.g. ask_user_question responses). Without this, tool results are only
  // persisted when the workflow finishes, so switching devices mid-stream
  // would lose the tool result.
  void persistAssistantMessagesWithToolResults(chatId, messages);

  const runtimePromise = createChatRuntime({
    userId,
    sessionId,
    sessionRecord,
  });
  const preferencesPromise = getUserPreferences(userId).catch((error) => {
    console.error("Failed to load user preferences:", error);
    return null;
  });

  const [{ sandbox, skills }, rawPreferences] = await Promise.all([
    runtimePromise,
    preferencesPromise,
  ]);

  const preferences = rawPreferences
    ? sanitizeUserPreferencesForSession(rawPreferences, session, req.url)
    : null;
  const modelVariants = filterModelVariantsForSession(
    getAllVariants(preferences?.modelVariants ?? []),
    session,
    req.url,
  );
  const selectedModelId =
    sanitizeSelectedModelIdForSession(
      chat.modelId,
      modelVariants,
      session,
      req.url,
    ) ??
    chat.modelId ??
    null;
  const mainModelSelection = resolveChatModelSelection({
    selectedModelId,
    modelVariants,
    missingVariantLabel: "Selected model variant",
  });
  const subagentModelSelection = preferences?.defaultSubagentModelId
    ? resolveChatModelSelection({
        selectedModelId: sanitizeSelectedModelIdForSession(
          preferences.defaultSubagentModelId,
          modelVariants,
          session,
          req.url,
        ),
        modelVariants,
        missingVariantLabel: "Subagent model variant",
      })
    : undefined;

  // Determine if auto-commit and auto-PR should run after a natural finish.
  const shouldAutoCommitPush =
    sessionRecord.autoCommitPushOverride ??
    preferences?.autoCommitPush ??
    false;
  const shouldAutoCreatePr =
    shouldAutoCommitPush &&
    (sessionRecord.autoCreatePrOverride ?? preferences?.autoCreatePr ?? false);

  // Collect enabled MCP connection IDs — MCP tools are resolved inside the
  // workflow step because ToolSet objects contain Zod schemas with Symbols
  // that cannot be serialized across the durable workflow boundary.
  const enabledMcpIds =
    (
      sessionRecord as typeof sessionRecord & {
        enabledMcpConnectionIds?: string[];
      }
    ).enabledMcpConnectionIds ?? [];

  // Start the durable workflow
  const run = await start(runAgentWorkflow, [
    {
      messages,
      chatId,
      sessionId,
      userId,
      selectedModelId: selectedModelId ?? mainModelSelection.id,
      modelId: mainModelSelection.id,
      maxSteps: 500,
      enabledMcpConnectionIds:
        enabledMcpIds.length > 0 ? enabledMcpIds : undefined,
      agentOptions: {
        sandbox: {
          state: activeSandboxState,
          workingDirectory: sandbox.workingDirectory,
          currentBranch: sandbox.currentBranch,
          environmentDetails: sandbox.environmentDetails,
        },
        model: mainModelSelection,
        ...(subagentModelSelection
          ? { subagentModel: subagentModelSelection }
          : {}),
        ...(skills.length > 0 && { skills }),
        customInstructions: assistantFileLinkPrompt,
      },
      ...(shouldAutoCommitPush &&
        sessionRecord.repoOwner &&
        sessionRecord.repoName && {
          autoCommitEnabled: true,
          autoCreatePrEnabled: shouldAutoCreatePr,
          sessionTitle: sessionRecord.title,
          repoOwner: sessionRecord.repoOwner,
          repoName: sessionRecord.repoName,
        }),
    },
  ]);

  // Idempotently claim the activeStreamId slot for the workflow we just
  // started. This succeeds both when the slot is still null and when the
  // workflow already self-claimed it from inside its first step.
  const claimed = await claimChatActiveStreamId(chatId, run.runId);

  if (!claimed) {
    // Another request or workflow run owns the slot — cancel our duplicate.
    try {
      const { getRun } = await import("workflow/api");
      getRun(run.runId).cancel();
    } catch {
      // Best-effort cleanup.
    }
    return Response.json(
      { error: "Another workflow is already running for this chat" },
      { status: 409 },
    );
  }

  const stream = createCancelableReadableStream(
    run.getReadable<WebAgentUIMessageChunk>(),
  );

  return createUIMessageStreamResponse({
    stream,
    headers: {
      "x-workflow-run-id": run.runId,
    },
  });
}

type ExistingActiveStreamResolution =
  | {
      action: "resume";
      runId: string;
      stream: ReadableStream<WebAgentUIMessageChunk>;
    }
  | {
      action: "ready";
    }
  | {
      action: "conflict";
    };

const ACTIVE_STREAM_RECONCILIATION_MAX_ATTEMPTS = 3;

async function reconcileExistingActiveStream(
  chatId: string,
  activeStreamId: string,
): Promise<ExistingActiveStreamResolution> {
  const { getRun } = await import("workflow/api");
  let currentStreamId: string | null = activeStreamId;

  for (
    let attempt = 1;
    currentStreamId && attempt <= ACTIVE_STREAM_RECONCILIATION_MAX_ATTEMPTS;
    attempt++
  ) {
    try {
      const existingRun = getRun(currentStreamId);
      const status = await existingRun.status;
      if (status === "running" || status === "pending") {
        return {
          action: "resume",
          runId: currentStreamId,
          stream: createCancelableReadableStream(
            existingRun.getReadable<WebAgentUIMessageChunk>(),
          ),
        };
      }
    } catch {
      // Workflow not found or inaccessible — try to clear the stale stream ID.
    }

    const cleared = await compareAndSetChatActiveStreamId(
      chatId,
      currentStreamId,
      null,
    );
    if (cleared) {
      return { action: "ready" };
    }

    const latestChat = await getChatById(chatId);
    currentStreamId = latestChat?.activeStreamId ?? null;
  }

  return currentStreamId ? { action: "conflict" } : { action: "ready" };
}

async function persistLatestUserMessage(
  chatId: string,
  messages: WebAgentUIMessage[],
): Promise<void> {
  const latestMessage = messages[messages.length - 1];
  if (!latestMessage || latestMessage.role !== "user") {
    return;
  }

  try {
    const created = await createChatMessageIfNotExists({
      id: latestMessage.id,
      chatId,
      role: "user",
      parts: latestMessage,
    });

    if (!created) {
      return;
    }

    await touchChat(chatId);

    const shouldSetTitle = await isFirstChatMessage(chatId, created.id);
    if (!shouldSetTitle) {
      return;
    }

    const textContent = latestMessage.parts
      .filter(
        (part): part is { type: "text"; text: string } => part.type === "text",
      )
      .map((part) => part.text)
      .join(" ")
      .trim();

    if (textContent.length > 0) {
      const title =
        textContent.length > 80
          ? `${textContent.slice(0, 80)}...`
          : textContent;
      await updateChat(chatId, { title });
    }
  } catch (error) {
    console.error("Failed to persist user message:", error);
  }
}
