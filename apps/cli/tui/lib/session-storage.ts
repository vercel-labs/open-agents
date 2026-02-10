import { homedir } from "node:os";
import { join } from "node:path";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  stat,
  rename,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { TUIAgentUIMessage } from "../types";
import type { SessionData, SessionListItem } from "./session-types";

const CONFIG_DIR = join(homedir(), ".config", "open-harness");
const SESSIONS_DIR = join(CONFIG_DIR, "sessions");

/**
 * Encode a project path for use as a filesystem-safe directory name.
 * Example: /Users/nico/code/project → Users-nico-code-project
 */
export function encodeProjectPath(path: string): string {
  return path.replace(/[\\/]/g, "-").replace(/^-/, "");
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
  return join(getProjectSessionsDir(projectPath), `${sessionId}.json`);
}

/**
 * Create a new session and return the session ID.
 */
export async function createSession(
  projectPath: string,
  branch: string,
): Promise<string> {
  const sessionId = randomUUID();
  const sessionsDir = getProjectSessionsDir(projectPath);

  await mkdir(sessionsDir, { recursive: true });

  const sessionData: SessionData = {
    id: sessionId,
    projectPath,
    branch,
    createdAt: new Date().toISOString(),
    messages: [],
  };

  const filePath = getSessionFilePath(projectPath, sessionId);
  await writeFile(filePath, JSON.stringify(sessionData, null, 2));

  return sessionId;
}

/**
 * Save all messages to a session (overwrites file).
 */
export async function saveSession(
  projectPath: string,
  sessionId: string,
  branch: string,
  messages: TUIAgentUIMessage[],
): Promise<void> {
  const sessionsDir = getProjectSessionsDir(projectPath);
  await mkdir(sessionsDir, { recursive: true });

  // Load existing session to preserve createdAt, or create new metadata
  const filePath = getSessionFilePath(projectPath, sessionId);
  let createdAt: string;

  try {
    const existing = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(existing) as SessionData;
    createdAt = parsed.createdAt;
  } catch {
    createdAt = new Date().toISOString();
  }

  const sessionData: SessionData = {
    id: sessionId,
    projectPath,
    branch,
    createdAt,
    messages,
  };

  // Write to temp file, then atomic rename to prevent corruption from partial writes
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(tempPath, JSON.stringify(sessionData, null, 2));
  await rename(tempPath, filePath);
}

/**
 * Load a session for resume.
 */
export async function loadSession(
  projectPath: string,
  sessionId: string,
): Promise<SessionData | null> {
  const filePath = getSessionFilePath(projectPath, sessionId);

  try {
    const content = await readFile(filePath, "utf-8");
    const data = JSON.parse(content) as SessionData;
    return data;
  } catch {
    return null;
  }
}

/**
 * List sessions for a project, sorted by last activity (most recent first).
 */
export async function listSessions(
  projectPath: string,
): Promise<SessionListItem[]> {
  const sessionsDir = getProjectSessionsDir(projectPath);

  let files: string[];
  try {
    files = await readdir(sessionsDir);
  } catch {
    return [];
  }

  const sessions: SessionListItem[] = [];

  for (const file of files) {
    if (!file.endsWith(".json")) continue;

    const filePath = join(sessionsDir, file);
    try {
      const content = await readFile(filePath, "utf-8");
      const data = JSON.parse(content) as SessionData;

      // Skip sessions with no messages
      if (!data.messages || data.messages.length === 0) continue;

      // Get file modification time for lastActivity
      const fileStat = await stat(filePath);
      const lastActivity = fileStat.mtime;

      // Extract preview from first user message
      let preview = "(no preview)";
      for (const msg of data.messages) {
        if (msg.role === "user") {
          const textPart = (
            msg.parts as Array<{ type: string; text?: string }>
          ).find((p) => p.type === "text" && p.text);
          if (textPart?.text) {
            preview =
              textPart.text.length > 60
                ? textPart.text.slice(0, 57) + "..."
                : textPart.text;
            break;
          }
        }
      }

      sessions.push({
        id: data.id,
        branch: data.branch,
        createdAt: new Date(data.createdAt),
        lastActivity,
        messageCount: data.messages.length,
        preview,
      });
    } catch {
      // Skip invalid files
    }
  }

  // Sort by last activity (most recent first)
  sessions.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());

  return sessions;
}

/**
 * Format a date as a relative time string.
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
