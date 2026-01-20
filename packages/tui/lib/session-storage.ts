import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  sessionMetadataSchema,
  sessionMessageSchema,
  type SessionMetadata,
  type SessionMessage,
  type SessionListItem,
  type SessionData,
} from "./session-types";
import type { TUIAgentUIMessage } from "../types";

const CONFIG_DIR = join(homedir(), ".config", "open-harness");
const SESSIONS_DIR = join(CONFIG_DIR, "sessions");

/**
 * Encode a project path for use as a filesystem-safe directory name.
 * Example: /Users/nico/code/project → -Users-nico-code-project
 */
export function encodeProjectPath(path: string): string {
  return path.replace(/\//g, "-").replace(/^-/, "");
}

/**
 * Decode an encoded project path back to the original path.
 * Example: -Users-nico-code-project → /Users/nico/code/project
 */
export function decodeProjectPath(encoded: string): string {
  return "/" + encoded.replace(/-/g, "/");
}

/**
 * Get the sessions directory for a specific project.
 */
function getProjectSessionsDir(projectPath: string): string {
  const encoded = encodeProjectPath(projectPath);
  return join(SESSIONS_DIR, encoded);
}

/**
 * Get the full path to a session file.
 */
function getSessionFilePath(projectPath: string, sessionId: string): string {
  return join(getProjectSessionsDir(projectPath), `${sessionId}.jsonl`);
}

/**
 * Create a new session and write its metadata.
 * Returns the new session ID.
 */
export async function createSession(
  projectPath: string,
  gitBranch: string,
): Promise<string> {
  const sessionId = randomUUID();
  const sessionsDir = getProjectSessionsDir(projectPath);

  await mkdir(sessionsDir, { recursive: true });

  const metadata: SessionMetadata = {
    type: "metadata",
    sessionId,
    projectPath,
    gitBranch,
    createdAt: new Date().toISOString(),
  };

  const filePath = getSessionFilePath(projectPath, sessionId);
  await writeFile(filePath, JSON.stringify(metadata) + "\n");

  return sessionId;
}

/**
 * Append a message entry to a session's JSONL file.
 * Only user and assistant messages are persisted (system messages are skipped).
 */
export async function appendMessage(
  projectPath: string,
  sessionId: string,
  message: TUIAgentUIMessage,
  gitBranch: string,
): Promise<void> {
  // Only persist user and assistant messages
  if (message.role !== "user" && message.role !== "assistant") {
    return;
  }

  const entry: SessionMessage = {
    type: message.role,
    timestamp: new Date().toISOString(),
    gitBranch,
    message: {
      role: message.role,
      parts: message.parts,
      id: message.id,
      metadata: message.metadata,
    },
  };

  const filePath = getSessionFilePath(projectPath, sessionId);
  await writeFile(filePath, JSON.stringify(entry) + "\n", { flag: "a" });
}

/**
 * List all sessions for a project with summary metadata.
 * Returns sessions sorted by last activity (most recent first).
 */
export async function listSessions(
  projectPath: string,
): Promise<SessionListItem[]> {
  const sessionsDir = getProjectSessionsDir(projectPath);

  let files: string[];
  try {
    files = await readdir(sessionsDir);
  } catch {
    // Directory doesn't exist - no sessions
    return [];
  }

  const sessions: SessionListItem[] = [];

  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;

    const filePath = join(sessionsDir, file);
    try {
      const content = await readFile(filePath, "utf-8");
      const lines = content.trim().split("\n");

      if (lines.length === 0 || !lines[0]) continue;

      // Parse metadata from first line
      const metadataResult = sessionMetadataSchema.safeParse(
        JSON.parse(lines[0]),
      );
      if (!metadataResult.success) continue;
      const metadata = metadataResult.data;

      // Parse messages to extract preview and count
      let messageCount = 0;
      let firstUserMessage = "";
      let lastTimestamp = metadata.createdAt;
      let lastBranch = metadata.gitBranch;

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;

        try {
          const msgResult = sessionMessageSchema.safeParse(JSON.parse(line));
          if (!msgResult.success) continue;
          const msg = msgResult.data;

          messageCount++;
          lastTimestamp = msg.timestamp;
          lastBranch = msg.gitBranch;

          // Get first user message for preview
          if (!firstUserMessage && msg.type === "user") {
            const textPart = (
              msg.message.parts as Array<{ type: string; text?: string }>
            ).find((p) => p.type === "text" && p.text);
            if (textPart?.text) {
              firstUserMessage = textPart.text;
            }
          }
        } catch {
          // Skip invalid message lines
        }
      }

      // Skip sessions with no messages (only metadata)
      if (messageCount === 0) continue;

      // Truncate preview to 60 characters
      const preview =
        firstUserMessage.length > 60
          ? firstUserMessage.slice(0, 57) + "..."
          : firstUserMessage || "(no preview)";

      sessions.push({
        sessionId: metadata.sessionId,
        projectPath: metadata.projectPath,
        gitBranch: lastBranch,
        createdAt: new Date(metadata.createdAt),
        lastActivity: new Date(lastTimestamp),
        messageCount,
        firstMessagePreview: preview,
      });
    } catch {
      // Skip files that can't be read or parsed
    }
  }

  // Sort by last activity (most recent first)
  sessions.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());

  return sessions;
}

/**
 * Load a complete session for restoration.
 */
export async function loadSession(
  projectPath: string,
  sessionId: string,
): Promise<SessionData | null> {
  const filePath = getSessionFilePath(projectPath, sessionId);

  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n");

    if (lines.length === 0 || !lines[0]) return null;

    // Parse metadata
    const metadataResult = sessionMetadataSchema.safeParse(
      JSON.parse(lines[0]),
    );
    if (!metadataResult.success) return null;
    const metadata = metadataResult.data;

    // Parse messages
    const messages: SessionMessage[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      try {
        const msgResult = sessionMessageSchema.safeParse(JSON.parse(line));
        if (msgResult.success) {
          messages.push(msgResult.data);
        }
      } catch {
        // Skip invalid lines
      }
    }

    return { metadata, messages };
  } catch {
    return null;
  }
}

/**
 * Format a date as a relative time string.
 * Example: "2h ago", "3d ago", "just now"
 */
export function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);

  if (diffSeconds < 60) {
    return "just now";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }
  return `${diffWeeks}w ago`;
}
