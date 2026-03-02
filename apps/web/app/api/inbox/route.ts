import { and, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chatMessages, chatReads, chats, sessions } from "@/lib/db/schema";
import { getServerSession } from "@/lib/session/get-server-session";

/**
 * Attention states for the inbox view.
 *
 * - needs_input:  Agent is blocked — has a pending ask_user_question, or
 *                 finished with text but no file changes (likely asking/clarifying).
 * - needs_review: Agent finished and there are unstaged code changes to review.
 * - working:      Agent is actively streaming.
 * - idle:         Nothing requires attention.
 */
export type AttentionState =
  | "needs_input"
  | "needs_review"
  | "working"
  | "idle";

export interface InboxDiffFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  stagingStatus?: "staged" | "unstaged" | "partial";
  additions: number;
  deletions: number;
  diff: string;
  oldPath?: string;
  generated?: boolean;
}

export interface InboxDiff {
  files: InboxDiffFile[];
  summary: {
    totalFiles: number;
    totalAdditions: number;
    totalDeletions: number;
  };
  baseRef?: string;
}

export interface InboxItem {
  sessionId: string;
  sessionTitle: string;
  repoOwner: string | null;
  repoName: string | null;
  branch: string | null;
  status: string;
  attentionState: AttentionState;
  linesAdded: number | null;
  linesRemoved: number | null;
  prNumber: number | null;
  prStatus: string | null;
  // Derived content
  objective: string | null; // First user message text (what was asked)
  latestTodos: TodoItem[] | null; // Most recent todo_write snapshot
  latestResponse: string | null; // Last assistant text (final answer)
  cachedDiff: InboxDiff | null; // Cached diff for inline viewing
  hasUnread: boolean;
  isStreaming: boolean;
  updatedAt: Date;
  createdAt: Date;
}

interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

interface MessagePart {
  type: string;
  text?: string;
  input?: { todos?: TodoItem[] };
  state?: string;
  [key: string]: unknown;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractPartsArray(raw: unknown): MessagePart[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObjectRecord) as MessagePart[];
}

/**
 * From an array of assistant message parts, extract the last todo_write
 * tool call's input.todos.
 */
function extractLatestTodos(parts: MessagePart[]): TodoItem[] | null {
  // Walk backwards to find the last todo_write
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (!part) continue;
    if (
      (part.type === "tool-todo_write" || part.type === "tool-invocation") &&
      part.input &&
      isObjectRecord(part.input) &&
      Array.isArray((part.input as Record<string, unknown>).todos)
    ) {
      return (part.input as { todos: TodoItem[] }).todos;
    }
  }
  return null;
}

/**
 * Check if any part is a pending ask_user_question.
 */
function hasPendingQuestion(parts: MessagePart[]): boolean {
  return parts.some(
    (p) => p.type === "tool-ask_user_question" && p.state === "input-available",
  );
}

/**
 * Extract the last text part from assistant message parts.
 */
function extractLastText(parts: MessagePart[]): string | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (
      part?.type === "text" &&
      typeof part.text === "string" &&
      part.text.trim()
    ) {
      return part.text.trim();
    }
  }
  return null;
}

/**
 * Extract the first user message text as the "objective".
 */
function extractObjective(parts: MessagePart[]): string | null {
  for (const part of parts) {
    if (
      part.type === "text" &&
      typeof part.text === "string" &&
      part.text.trim()
    ) {
      return part.text.trim();
    }
  }
  return null;
}

function deriveAttentionState(opts: {
  isStreaming: boolean;
  isArchived: boolean;
  hasPendingQuestion: boolean;
  hasChanges: boolean;
  hasUnread: boolean;
  latestResponse: string | null;
}): AttentionState {
  if (opts.isArchived) return "idle";
  if (opts.isStreaming) return "working";
  if (opts.hasPendingQuestion) return "needs_input";

  // Unstaged changes and not actively streaming → needs review regardless of
  // read state.  The user may have already read the chat but hasn't acted on
  // the changes (commit, PR, etc.).
  if (opts.hasChanges) return "needs_review";

  // Agent finished with unread text but no code changes — likely
  // asking/clarifying or returning a text-only response.
  if (opts.hasUnread && opts.latestResponse) return "needs_input";

  return "idle";
}

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const userId = session.user.id;

  // 1. Get all non-archived sessions with unread/streaming status
  const sessionRows = await db
    .select({
      ...getTableColumns(sessions),
      hasUnread: sql<boolean>`COALESCE(BOOL_OR(
        CASE
          WHEN ${chats.lastAssistantMessageAt} IS NULL THEN false
          WHEN ${chatReads.lastReadAt} IS NULL THEN true
          WHEN ${chats.lastAssistantMessageAt} > ${chatReads.lastReadAt} THEN true
          ELSE false
        END
      ), false)`,
      hasStreaming: sql<boolean>`COALESCE(BOOL_OR(${chats.activeStreamId} IS NOT NULL), false)`,
    })
    .from(sessions)
    .leftJoin(chats, eq(chats.sessionId, sessions.id))
    .leftJoin(
      chatReads,
      and(eq(chatReads.chatId, chats.id), eq(chatReads.userId, userId)),
    )
    .where(eq(sessions.userId, userId))
    .groupBy(sessions.id)
    .orderBy(desc(sessions.updatedAt));

  // Filter to only active (non-archived) sessions
  const activeSessions = sessionRows.filter((s) => s.status !== "archived");

  // 2. For each session, get the first user message and latest assistant message
  //    from the most recent chat.
  const inboxItems: InboxItem[] = [];

  for (const s of activeSessions) {
    // Get the most recent chat for this session
    const [latestChat] = await db
      .select({ id: chats.id })
      .from(chats)
      .where(eq(chats.sessionId, s.id))
      .orderBy(desc(chats.updatedAt))
      .limit(1);

    if (!latestChat) {
      inboxItems.push({
        sessionId: s.id,
        sessionTitle: s.title,
        repoOwner: s.repoOwner,
        repoName: s.repoName,
        branch: s.branch,
        status: s.status,
        attentionState: "idle",
        linesAdded: s.linesAdded,
        linesRemoved: s.linesRemoved,
        prNumber: s.prNumber,
        prStatus: s.prStatus,
        objective: null,
        latestTodos: null,
        latestResponse: null,
        cachedDiff: (s.cachedDiff as InboxDiff | null) ?? null,
        hasUnread: s.hasUnread,
        isStreaming: s.hasStreaming,
        updatedAt: s.updatedAt,
        createdAt: s.createdAt,
      });
      continue;
    }

    // Get first user message (objective)
    const [firstUserMsg] = await db
      .select({ parts: chatMessages.parts })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.chatId, latestChat.id),
          eq(chatMessages.role, "user"),
        ),
      )
      .orderBy(chatMessages.createdAt)
      .limit(1);

    // Get last assistant message (for todos, response, and pending questions)
    const [lastAssistantMsg] = await db
      .select({ parts: chatMessages.parts })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.chatId, latestChat.id),
          eq(chatMessages.role, "assistant"),
        ),
      )
      .orderBy(desc(chatMessages.createdAt))
      .limit(1);

    const userParts = extractPartsArray(firstUserMsg?.parts);
    const assistantParts = extractPartsArray(lastAssistantMsg?.parts);

    const objective = extractObjective(userParts);
    const latestTodos = extractLatestTodos(assistantParts);
    const latestResponse = extractLastText(assistantParts);
    const pendingQuestion = hasPendingQuestion(assistantParts);

    const hasChanges =
      (s.linesAdded !== null && s.linesAdded > 0) ||
      (s.linesRemoved !== null && s.linesRemoved > 0);

    const attentionState = deriveAttentionState({
      isStreaming: s.hasStreaming,
      isArchived: s.status === "archived",
      hasPendingQuestion: pendingQuestion,
      hasChanges,
      hasUnread: s.hasUnread,
      latestResponse,
    });

    inboxItems.push({
      sessionId: s.id,
      sessionTitle: s.title,
      repoOwner: s.repoOwner,
      repoName: s.repoName,
      branch: s.branch,
      status: s.status,
      attentionState,
      linesAdded: s.linesAdded,
      linesRemoved: s.linesRemoved,
      prNumber: s.prNumber,
      prStatus: s.prStatus,
      objective,
      latestTodos,
      latestResponse,
      cachedDiff: (s.cachedDiff as InboxDiff | null) ?? null,
      hasUnread: s.hasUnread,
      isStreaming: s.hasStreaming,
      updatedAt: s.updatedAt,
      createdAt: s.createdAt,
    });
  }

  // Sort: needs_input first, then needs_review, then working, then idle
  const priorityOrder: Record<AttentionState, number> = {
    needs_input: 0,
    needs_review: 1,
    working: 2,
    idle: 3,
  };

  inboxItems.sort(
    (a, b) => priorityOrder[a.attentionState] - priorityOrder[b.attentionState],
  );

  return Response.json({ items: inboxItems });
}
