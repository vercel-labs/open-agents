import type { WebAgentUIMessage } from "@/app/types";

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
