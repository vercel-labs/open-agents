import type { TUIAgentUIMessage } from "../types";

/**
 * Full session data stored as a single JSON file
 */
export interface SessionData {
  id: string;
  projectPath: string;
  branch: string;
  createdAt: string;
  messages: TUIAgentUIMessage[];
}

/**
 * Summary info for listing sessions
 */
export interface SessionListItem {
  id: string;
  branch: string;
  createdAt: Date;
  lastActivity: Date;
  messageCount: number;
  preview: string;
}
