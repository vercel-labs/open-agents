import { z } from "zod";
import type { TUIAgentUIMessage } from "../types";

/**
 * Session metadata (first line of JSONL file)
 */
export const sessionMetadataSchema = z.object({
  type: z.literal("metadata"),
  sessionId: z.string().uuid(),
  projectPath: z.string(),
  gitBranch: z.string(),
  createdAt: z.string(),
});

export type SessionMetadata = z.infer<typeof sessionMetadataSchema>;

/**
 * Message entry (subsequent lines in JSONL file)
 */
export const sessionMessageSchema = z.object({
  type: z.enum(["user", "assistant"]),
  timestamp: z.string(),
  gitBranch: z.string(),
  message: z.object({
    role: z.enum(["user", "assistant"]),
    parts: z.array(z.unknown()),
    id: z.string(),
    metadata: z.unknown().optional(),
  }),
});

export type SessionMessage = z.infer<typeof sessionMessageSchema>;

/**
 * For listing UI - summary info about a session
 */
export interface SessionListItem {
  sessionId: string;
  projectPath: string;
  gitBranch: string;
  createdAt: Date;
  lastActivity: Date;
  messageCount: number;
  firstMessagePreview: string;
}

/**
 * Full session data for restoration
 */
export interface SessionData {
  metadata: SessionMetadata;
  messages: SessionMessage[];
}

/**
 * Convert stored session messages back to TUIAgentUIMessage format
 */
export function convertToUIMessages(
  sessionMessages: SessionMessage[],
): TUIAgentUIMessage[] {
  return sessionMessages.map((sm) => ({
    role: sm.message.role,
    parts: sm.message.parts as TUIAgentUIMessage["parts"],
    id: sm.message.id,
    metadata: sm.message.metadata as TUIAgentUIMessage["metadata"],
  }));
}
