import type { SandboxState } from "@open-harness/sandbox";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "./client";
import {
  chatMessages,
  chatReads,
  chats,
  type NewChat,
  type NewChatMessage,
  type NewChatRead,
  type NewSession,
  type NewShare,
  sessions,
  shares,
} from "./schema";

export function normalizeLegacySandboxState(
  sandboxState: unknown,
): SandboxState | null | undefined {
  if (!sandboxState || typeof sandboxState !== "object") {
    return sandboxState as null | undefined;
  }

  const state = sandboxState as Record<string, unknown>;
  const normalizedType = state.type === "hybrid" ? "vercel" : state.type;
  const sandboxName =
    typeof state.sandboxName === "string" && state.sandboxName.length > 0
      ? state.sandboxName
      : typeof state.sandboxId === "string" && state.sandboxId.length > 0
        ? state.sandboxId
        : undefined;

  if (normalizedType !== "vercel") {
    return sandboxState as SandboxState;
  }

  if (normalizedType === state.type && sandboxName === undefined) {
    return sandboxState as SandboxState;
  }

  const normalizedState: Record<string, unknown> = {
    ...state,
    type: normalizedType,
  };

  if (sandboxName !== undefined) {
    normalizedState.sandboxName = sandboxName;
    delete normalizedState.sandboxId;
  }

  return normalizedState as unknown as SandboxState;
}

function normalizeSessionRecord<T extends { sandboxState: unknown }>(
  session: T,
): T {
  return {
    ...session,
    sandboxState: normalizeLegacySandboxState(session.sandboxState) ?? null,
  };
}

export async function createSession(data: NewSession) {
  const [session] = await db.insert(sessions).values(data).returning();
  if (!session) {
    throw new Error("Failed to create session");
  }
  return normalizeSessionRecord(session);
}

interface CreateSessionWithInitialChatInput {
  session: NewSession;
  initialChat: Pick<NewChat, "id" | "title" | "modelId">;
}

export async function createSessionWithInitialChat(
  input: CreateSessionWithInitialChatInput,
) {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .insert(sessions)
      .values(input.session)
      .returning();
    if (!session) {
      throw new Error("Failed to create session");
    }

    const [chat] = await tx
      .insert(chats)
      .values({
        id: input.initialChat.id,
        sessionId: session.id,
        title: input.initialChat.title,
        modelId: input.initialChat.modelId,
      })
      .returning();
    if (!chat) {
      throw new Error("Failed to create chat");
    }

    return { session: normalizeSessionRecord(session), chat };
  });
}

export async function getSessionById(sessionId: string) {
  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
  });

  return session ? normalizeSessionRecord(session) : session;
}

export async function getShareById(shareId: string) {
  return db.query.shares.findFirst({
    where: eq(shares.id, shareId),
  });
}

export async function getShareByChatId(chatId: string) {
  return db.query.shares.findFirst({
    where: eq(shares.chatId, chatId),
  });
}

export async function createShareIfNotExists(data: NewShare) {
  const [share] = await db
    .insert(shares)
    .values(data)
    .onConflictDoNothing({ target: shares.chatId })
    .returning();

  if (share) {
    return share;
  }

  return getShareByChatId(data.chatId);
}

export async function deleteShareByChatId(chatId: string) {
  await db.delete(shares).where(eq(shares.chatId, chatId));
}

export async function getSessionsByUserId(userId: string) {
  const records = await db.query.sessions.findMany({
    where: eq(sessions.userId, userId),
    orderBy: [desc(sessions.createdAt)],
  });

  return records.map((session) => normalizeSessionRecord(session));
}

export async function countSessionsByUserId(userId: string): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(sessions)
    .where(eq(sessions.userId, userId));

  return result?.count ?? 0;
}

export async function countUserMessagesByUserId(
  userId: string,
): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(chatMessages)
    .innerJoin(chats, eq(chats.id, chatMessages.chatId))
    .innerJoin(sessions, eq(sessions.id, chats.sessionId))
    .where(and(eq(sessions.userId, userId), eq(chatMessages.role, "user")));

  return result?.count ?? 0;
}

type SessionSidebarFields = Pick<
  typeof sessions.$inferSelect,
  | "id"
  | "title"
  | "status"
  | "repoOwner"
  | "repoName"
  | "branch"
  | "linesAdded"
  | "linesRemoved"
  | "prNumber"
  | "prStatus"
  | "createdAt"
>;

export type SessionWithUnread = SessionSidebarFields & {
  hasUnread: boolean;
  hasStreaming: boolean;
  latestChatId: string | null;
  lastActivityAt: Date;
};

type GetSessionsWithUnreadByUserIdOptions = {
  status?: "all" | "active" | "archived";
  limit?: number;
  offset?: number;
};

/**
 * Returns sessions for a user, each annotated with a `hasUnread` flag
 * that is true when any chat in the session has unread assistant messages.
 *
 * The sidebar only needs lightweight fields, so we intentionally avoid
 * selecting heavyweight JSON columns like `sandboxState` and `cachedDiff`.
 */
export async function getSessionsWithUnreadByUserId(
  userId: string,
  options?: GetSessionsWithUnreadByUserIdOptions,
): Promise<SessionWithUnread[]> {
  const status = options?.status ?? "all";
  const statusFilter =
    status === "active"
      ? ne(sessions.status, "archived")
      : status === "archived"
        ? eq(sessions.status, "archived")
        : undefined;

  const baseQuery = db
    .select({
      id: sessions.id,
      title: sessions.title,
      status: sessions.status,
      repoOwner: sessions.repoOwner,
      repoName: sessions.repoName,
      branch: sessions.branch,
      linesAdded: sessions.linesAdded,
      linesRemoved: sessions.linesRemoved,
      prNumber: sessions.prNumber,
      prStatus: sessions.prStatus,
      createdAt: sessions.createdAt,
      lastActivityAt: sql<Date>`COALESCE(MAX(${chats.updatedAt}), ${sessions.createdAt})`,
      hasUnread: sql<boolean>`COALESCE(BOOL_OR(
        CASE
          WHEN ${chats.lastAssistantMessageAt} IS NULL THEN false
          WHEN ${chatReads.lastReadAt} IS NULL THEN true
          WHEN ${chats.lastAssistantMessageAt} > ${chatReads.lastReadAt} THEN true
          ELSE false
        END
      ), false)`,
      hasStreaming: sql<boolean>`COALESCE(BOOL_OR(${chats.activeStreamId} IS NOT NULL), false)`,
      latestChatId: sql<string | null>`(
        ARRAY_AGG(${chats.id} ORDER BY ${chats.updatedAt} DESC, ${chats.createdAt} DESC)
        FILTER (WHERE ${chats.id} IS NOT NULL)
      )[1]`,
    })
    .from(sessions)
    .leftJoin(chats, eq(chats.sessionId, sessions.id))
    .leftJoin(
      chatReads,
      and(eq(chatReads.chatId, chats.id), eq(chatReads.userId, userId)),
    )
    .where(
      statusFilter
        ? and(eq(sessions.userId, userId), statusFilter)
        : eq(sessions.userId, userId),
    )
    .groupBy(sessions.id)
    .orderBy(desc(sessions.createdAt));

  const withOffset =
    typeof options?.offset === "number" && options.offset > 0
      ? baseQuery.offset(options.offset)
      : baseQuery;

  const rows =
    typeof options?.limit === "number"
      ? await withOffset.limit(options.limit)
      : await withOffset;

  return rows;
}

export async function getArchivedSessionCountByUserId(
  userId: string,
): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), eq(sessions.status, "archived")));

  return result?.count ?? 0;
}

/**
 * Returns a Set of all session titles for a given user.
 * Used to avoid duplicate random city names when creating new sessions.
 */
export async function getUsedSessionTitles(
  userId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ title: sessions.title })
    .from(sessions)
    .where(eq(sessions.userId, userId));
  return new Set(rows.map((r) => r.title));
}

export async function updateSession(
  sessionId: string,
  data: Partial<Omit<NewSession, "id" | "userId" | "createdAt">>,
) {
  const [session] = await db
    .update(sessions)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(sessions.id, sessionId))
    .returning();

  return session ? normalizeSessionRecord(session) : session;
}

/**
 * Atomically claims the session lifecycle lease when no run is currently
 * recorded. Returns true when the claim succeeds.
 */
export async function claimSessionLifecycleRunId(
  sessionId: string,
  runId: string,
) {
  const [updated] = await db
    .update(sessions)
    .set({ lifecycleRunId: runId, updatedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.lifecycleRunId)))
    .returning({ id: sessions.id });

  return Boolean(updated);
}

export async function deleteSession(sessionId: string) {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function createChat(data: NewChat) {
  const [chat] = await db.insert(chats).values(data).returning();
  if (!chat) {
    throw new Error("Failed to create chat");
  }
  return chat;
}

export async function getChatById(chatId: string) {
  return db.query.chats.findFirst({
    where: eq(chats.id, chatId),
  });
}

/**
 * Get all chats for a session, ordered by most recent activity first.
 * Activity is tracked on chats.updatedAt and updated when new messages arrive.
 */
export async function getChatsBySessionId(sessionId: string) {
  return db.query.chats.findMany({
    where: eq(chats.sessionId, sessionId),
    orderBy: [desc(chats.updatedAt), desc(chats.createdAt)],
  });
}

export type ChatSummary = typeof chats.$inferSelect & {
  hasUnread: boolean;
  isStreaming: boolean;
};

/**
 * Returns chats with per-user unread flags for sidebar rendering.
 */
export async function getChatSummariesBySessionId(
  sessionId: string,
  userId: string,
): Promise<ChatSummary[]> {
  const rows = await db
    .select({
      id: chats.id,
      sessionId: chats.sessionId,
      title: chats.title,
      modelId: chats.modelId,
      activeStreamId: chats.activeStreamId,
      lastAssistantMessageAt: chats.lastAssistantMessageAt,
      createdAt: chats.createdAt,
      updatedAt: chats.updatedAt,
      hasUnread: sql<boolean>`
        CASE
          WHEN ${chats.lastAssistantMessageAt} IS NULL THEN false
          WHEN ${chatReads.lastReadAt} IS NULL THEN true
          WHEN ${chats.lastAssistantMessageAt} > ${chatReads.lastReadAt} THEN true
          ELSE false
        END
      `,
      isStreaming: sql<boolean>`${chats.activeStreamId} IS NOT NULL`,
    })
    .from(chats)
    .leftJoin(
      chatReads,
      and(eq(chatReads.chatId, chats.id), eq(chatReads.userId, userId)),
    )
    .where(eq(chats.sessionId, sessionId))
    .orderBy(chats.createdAt);

  return rows;
}

export async function updateChat(
  chatId: string,
  data: Partial<Omit<NewChat, "id" | "sessionId" | "createdAt">>,
) {
  const [chat] = await db
    .update(chats)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(chats.id, chatId))
    .returning();
  return chat;
}

export async function touchChat(chatId: string, activityAt = new Date()) {
  const [chat] = await db
    .update(chats)
    .set({ updatedAt: activityAt })
    .where(eq(chats.id, chatId))
    .returning();
  return chat;
}

export async function updateChatAssistantActivity(
  chatId: string,
  activityAt: Date,
) {
  const [chat] = await db
    .update(chats)
    .set({
      lastAssistantMessageAt: activityAt,
      updatedAt: activityAt,
    })
    .where(eq(chats.id, chatId))
    .returning();
  return chat;
}

export async function updateChatActiveStreamId(
  chatId: string,
  streamId: string | null,
) {
  await db
    .update(chats)
    .set({ activeStreamId: streamId })
    .where(eq(chats.id, chatId));
}

/**
 * Atomically updates activeStreamId only when the current value matches
 * `expectedStreamId`. Returns true when the update succeeds.
 */
export async function compareAndSetChatActiveStreamId(
  chatId: string,
  expectedStreamId: string | null,
  nextStreamId: string | null,
) {
  const activeStreamMatch =
    expectedStreamId === null
      ? isNull(chats.activeStreamId)
      : eq(chats.activeStreamId, expectedStreamId);

  const [updated] = await db
    .update(chats)
    .set({ activeStreamId: nextStreamId })
    .where(and(eq(chats.id, chatId), activeStreamMatch))
    .returning({ id: chats.id });

  return Boolean(updated);
}

export async function deleteChat(chatId: string) {
  await db.delete(chats).where(eq(chats.id, chatId));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cloneChatMessagePartsWithId(parts: unknown, id: string): unknown {
  const clonedParts = structuredClone(parts);
  if (!isRecord(clonedParts)) {
    return clonedParts;
  }

  return {
    ...clonedParts,
    id,
  };
}

type ForkChatThroughMessageInput = {
  userId: string;
  sourceChatId: string;
  throughMessageId: string;
  forkedChat: Pick<NewChat, "id" | "sessionId" | "title" | "modelId">;
};

type ForkChatThroughMessageResult =
  | { status: "created"; chat: typeof chats.$inferSelect }
  | { status: "message_not_found" }
  | { status: "not_assistant_message" };

export async function forkChatThroughMessage(
  input: ForkChatThroughMessageInput,
): Promise<ForkChatThroughMessageResult> {
  return db.transaction(async (tx) => {
    const sourceMessages = await tx
      .select({
        id: chatMessages.id,
        role: chatMessages.role,
        parts: chatMessages.parts,
        createdAt: chatMessages.createdAt,
      })
      .from(chatMessages)
      .where(eq(chatMessages.chatId, input.sourceChatId))
      .orderBy(chatMessages.createdAt, chatMessages.id);

    const throughMessageIndex = sourceMessages.findIndex(
      (message) => message.id === input.throughMessageId,
    );
    if (throughMessageIndex < 0) {
      return { status: "message_not_found" };
    }

    const throughMessage = sourceMessages[throughMessageIndex];
    if (!throughMessage || throughMessage.role !== "assistant") {
      return { status: "not_assistant_message" };
    }

    const now = new Date();
    const [forkedChat] = await tx
      .insert(chats)
      .values({
        ...input.forkedChat,
        activeStreamId: null,
        lastAssistantMessageAt: throughMessage.createdAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!forkedChat) {
      throw new Error("Failed to create forked chat");
    }

    const messagesToCopy = sourceMessages.slice(0, throughMessageIndex + 1);
    if (messagesToCopy.length > 0) {
      await tx.insert(chatMessages).values(
        messagesToCopy.map((message) => {
          const forkedMessageId = crypto.randomUUID();
          return {
            id: forkedMessageId,
            chatId: forkedChat.id,
            role: message.role,
            parts: cloneChatMessagePartsWithId(message.parts, forkedMessageId),
            createdAt: message.createdAt,
          };
        }),
      );
    }

    await tx
      .insert(chatReads)
      .values({
        userId: input.userId,
        chatId: forkedChat.id,
        lastReadAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [chatReads.userId, chatReads.chatId],
        set: {
          lastReadAt: now,
          updatedAt: now,
        },
      });

    return {
      status: "created",
      chat: forkedChat,
    };
  });
}

export async function createChatMessage(data: NewChatMessage) {
  const [message] = await db.insert(chatMessages).values(data).returning();
  if (!message) {
    throw new Error("Failed to create chat message");
  }
  return message;
}

/**
 * Creates a chat message if it doesn't already exist (idempotent insert).
 * Uses onConflictDoNothing to handle race conditions gracefully.
 * Returns the message if created, or undefined if it already existed.
 */
export async function createChatMessageIfNotExists(data: NewChatMessage) {
  const [message] = await db
    .insert(chatMessages)
    .values(data)
    .onConflictDoNothing({ target: chatMessages.id })
    .returning();
  return message;
}

/**
 * Upserts a chat message - inserts if new, updates parts if already exists.
 * Use this for assistant messages that may have tool results added client-side.
 */
export async function upsertChatMessage(data: NewChatMessage) {
  const [message] = await db
    .insert(chatMessages)
    .values(data)
    .onConflictDoUpdate({
      target: chatMessages.id,
      set: { parts: data.parts },
    })
    .returning();
  return message;
}

type UpsertChatMessageScopedResult =
  | { status: "inserted"; message: typeof chatMessages.$inferSelect }
  | { status: "updated"; message: typeof chatMessages.$inferSelect }
  | { status: "conflict" };

/**
 * Upserts a chat message only when the existing row matches the same chat and role.
 * This prevents accidental overwrite when an ID collision occurs across chats/roles.
 */
export async function upsertChatMessageScoped(
  data: NewChatMessage,
): Promise<UpsertChatMessageScopedResult> {
  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(chatMessages)
      .values(data)
      .onConflictDoNothing({ target: chatMessages.id })
      .returning();

    if (inserted) {
      return { status: "inserted", message: inserted };
    }

    const [updated] = await tx
      .update(chatMessages)
      .set({ parts: data.parts })
      .where(
        and(
          eq(chatMessages.id, data.id),
          eq(chatMessages.chatId, data.chatId),
          eq(chatMessages.role, data.role),
        ),
      )
      .returning();

    if (updated) {
      return { status: "updated", message: updated };
    }

    return { status: "conflict" };
  });
}

export async function getChatMessageById(messageId: string) {
  return db.query.chatMessages.findFirst({
    where: eq(chatMessages.id, messageId),
  });
}

export async function getChatMessages(chatId: string) {
  return db.query.chatMessages.findMany({
    where: eq(chatMessages.chatId, chatId),
    orderBy: [chatMessages.createdAt, chatMessages.id],
  });
}

type DeleteChatMessageAndFollowingResult =
  | { status: "not_found" }
  | { status: "not_user_message" }
  | { status: "deleted"; deletedMessageIds: string[] };

export async function deleteChatMessageAndFollowing(
  chatId: string,
  messageId: string,
): Promise<DeleteChatMessageAndFollowingResult> {
  return db.transaction(async (tx) => {
    const orderedMessages = await tx
      .select({
        id: chatMessages.id,
        role: chatMessages.role,
      })
      .from(chatMessages)
      .where(eq(chatMessages.chatId, chatId))
      .orderBy(chatMessages.createdAt, chatMessages.id);

    const startIndex = orderedMessages.findIndex(
      (message) => message.id === messageId,
    );
    if (startIndex < 0) {
      return { status: "not_found" };
    }

    const targetMessage = orderedMessages[startIndex];
    if (!targetMessage || targetMessage.role !== "user") {
      return { status: "not_user_message" };
    }

    const idsToDelete = orderedMessages
      .slice(startIndex)
      .map((message) => message.id);

    await tx
      .delete(chatMessages)
      .where(
        and(
          eq(chatMessages.chatId, chatId),
          inArray(chatMessages.id, idsToDelete),
        ),
      );

    const [latestAssistantMessage] = await tx
      .select({ createdAt: chatMessages.createdAt })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.chatId, chatId),
          eq(chatMessages.role, "assistant"),
        ),
      )
      .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
      .limit(1);

    await tx
      .update(chats)
      .set({
        lastAssistantMessageAt: latestAssistantMessage?.createdAt ?? null,
        updatedAt: new Date(),
      })
      .where(eq(chats.id, chatId));

    return {
      status: "deleted",
      deletedMessageIds: idsToDelete,
    };
  });
}

export async function isFirstChatMessage(chatId: string, messageId: string) {
  const rows = await db
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(eq(chatMessages.chatId, chatId))
    .orderBy(chatMessages.createdAt, chatMessages.id)
    .limit(2);

  return rows.length === 1 && rows[0]?.id === messageId;
}

export async function markChatRead(
  data: Pick<NewChatRead, "userId" | "chatId">,
) {
  const now = new Date();
  const [chatRead] = await db
    .insert(chatReads)
    .values({
      userId: data.userId,
      chatId: data.chatId,
      lastReadAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [chatReads.userId, chatReads.chatId],
      set: {
        lastReadAt: now,
        updatedAt: now,
      },
    })
    .returning();

  return chatRead;
}
