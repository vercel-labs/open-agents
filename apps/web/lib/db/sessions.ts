import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "./client";
import {
  chatMessages,
  chatReads,
  chats,
  type NewChat,
  type NewChatMessage,
  type NewChatRead,
  type NewSession,
  sessions,
} from "./schema";

export async function createSession(data: NewSession) {
  const [session] = await db.insert(sessions).values(data).returning();
  if (!session) {
    throw new Error("Failed to create session");
  }
  return session;
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

    return { session, chat };
  });
}

export async function getSessionById(sessionId: string) {
  return db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
  });
}

export async function getSessionByShareId(shareId: string) {
  return db.query.sessions.findFirst({
    where: eq(sessions.shareId, shareId),
  });
}

export async function getSessionsByUserId(userId: string) {
  return db.query.sessions.findMany({
    where: eq(sessions.userId, userId),
    orderBy: [desc(sessions.createdAt)],
  });
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
  return session;
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
 * Get all chats for a session, ordered by newest first.
 * This ordering is intentional - UI lists show newest at the top.
 */
export async function getChatsBySessionId(sessionId: string) {
  return db.query.chats.findMany({
    where: eq(chats.sessionId, sessionId),
    orderBy: [desc(chats.createdAt)],
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
    .orderBy(desc(chats.createdAt));

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
