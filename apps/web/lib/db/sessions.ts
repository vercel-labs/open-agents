import { desc, eq } from "drizzle-orm";
import { db } from "./client";
import {
  chatMessages,
  chats,
  type NewChat,
  type NewChatMessage,
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

export async function getSessionsByUserId(userId: string) {
  return db.query.sessions.findMany({
    where: eq(sessions.userId, userId),
    orderBy: [desc(sessions.createdAt)],
  });
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
