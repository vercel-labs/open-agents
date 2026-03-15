import type { WebAgentUIMessage } from "@/app/types";

export const DEFAULT_CONTEXT_LIMIT = 200_000;

export interface ChatCompactionContextPayload {
  contextLimit?: number;
  lastInputTokens?: number;
}

export interface ChatRequestBody {
  messages: WebAgentUIMessage[];
  sessionId?: string;
  chatId?: string;
  context?: ChatCompactionContextPayload;
}

export interface ChatCompactionContext {
  contextLimit: number;
  lastInputTokens?: number;
}

type ParseChatRequestResult =
  | {
      ok: true;
      body: ChatRequestBody;
    }
  | {
      ok: false;
      response: Response;
    };

type RequireChatIdentifiersResult =
  | {
      ok: true;
      sessionId: string;
      chatId: string;
    }
  | {
      ok: false;
      response: Response;
    };

function toPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
}

function toPositiveInputTokens(value: unknown): number | undefined {
  const normalized = toPositiveInteger(value);
  return normalized && normalized > 0 ? normalized : undefined;
}

function extractLastInputTokensFromMessages(
  messages: WebAgentUIMessage[],
): number | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!message || message.role !== "assistant") {
      continue;
    }

    const metadata = (message as { metadata?: unknown }).metadata;
    if (!metadata || typeof metadata !== "object") {
      continue;
    }

    const lastStepUsage = (metadata as { lastStepUsage?: unknown })
      .lastStepUsage;
    if (!lastStepUsage || typeof lastStepUsage !== "object") {
      continue;
    }

    const inputTokens = (lastStepUsage as { inputTokens?: unknown })
      .inputTokens;
    const normalizedTokens = toPositiveInputTokens(inputTokens);
    if (normalizedTokens) {
      return normalizedTokens;
    }
  }

  return undefined;
}

export async function parseChatRequestBody(
  req: Request,
): Promise<ParseChatRequestResult> {
  try {
    const body = (await req.json()) as ChatRequestBody;
    return { ok: true, body };
  } catch {
    return {
      ok: false,
      response: Response.json({ error: "Invalid JSON body" }, { status: 400 }),
    };
  }
}

export function requireChatIdentifiers(
  body: ChatRequestBody,
): RequireChatIdentifiersResult {
  if (!body.sessionId || !body.chatId) {
    return {
      ok: false,
      response: Response.json(
        { error: "sessionId and chatId are required" },
        { status: 400 },
      ),
    };
  }

  return {
    ok: true,
    sessionId: body.sessionId,
    chatId: body.chatId,
  };
}

export function buildCompactionContext(
  requestedCompactionContext: ChatCompactionContextPayload | undefined,
  messages: WebAgentUIMessage[],
): ChatCompactionContext {
  const requestedContextLimit = toPositiveInteger(
    requestedCompactionContext?.contextLimit,
  );
  const requestedLastInputTokens = toPositiveInputTokens(
    requestedCompactionContext?.lastInputTokens,
  );
  const inferredLastInputTokens = extractLastInputTokensFromMessages(messages);

  return {
    contextLimit: requestedContextLimit ?? DEFAULT_CONTEXT_LIMIT,
    lastInputTokens: requestedLastInputTokens ?? inferredLastInputTokens,
  };
}
