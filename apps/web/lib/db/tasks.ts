import { desc, eq } from "drizzle-orm";
import { db } from "./client";
import {
  tasks,
  taskMessages,
  type NewTask,
  type NewTaskMessage,
} from "./schema";

export async function createTask(data: NewTask) {
  const [task] = await db.insert(tasks).values(data).returning();
  if (!task) {
    throw new Error("Failed to create task");
  }
  return task;
}

export async function getTaskById(taskId: string) {
  return db.query.tasks.findFirst({
    where: eq(tasks.id, taskId),
  });
}

export async function getTasksByUserId(userId: string) {
  return db.query.tasks.findMany({
    where: eq(tasks.userId, userId),
    orderBy: [desc(tasks.createdAt)],
  });
}

export async function updateTask(
  taskId: string,
  data: Partial<Omit<NewTask, "id" | "userId" | "createdAt">>,
) {
  const [task] = await db
    .update(tasks)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(tasks.id, taskId))
    .returning();
  // Returns undefined if task doesn't exist
  return task;
}

export async function deleteTask(taskId: string) {
  await db.delete(tasks).where(eq(tasks.id, taskId));
}

export async function createTaskMessage(data: NewTaskMessage) {
  const [message] = await db.insert(taskMessages).values(data).returning();
  if (!message) {
    throw new Error("Failed to create task message");
  }
  return message;
}

/**
 * Creates a task message if it doesn't already exist (idempotent insert).
 * Uses onConflictDoNothing to handle race conditions gracefully.
 * Returns the message if created, or undefined if it already existed.
 */
export async function createTaskMessageIfNotExists(data: NewTaskMessage) {
  const [message] = await db
    .insert(taskMessages)
    .values(data)
    .onConflictDoNothing({ target: taskMessages.id })
    .returning();
  return message;
}

/**
 * Upserts a task message - inserts if new, updates parts if already exists.
 * Use this for assistant messages that may have tool results added client-side.
 */
export async function upsertTaskMessage(data: NewTaskMessage) {
  const [message] = await db
    .insert(taskMessages)
    .values(data)
    .onConflictDoUpdate({
      target: taskMessages.id,
      set: { parts: data.parts },
    })
    .returning();
  return message;
}

export async function getTaskMessageById(messageId: string) {
  return db.query.taskMessages.findFirst({
    where: eq(taskMessages.id, messageId),
  });
}

export async function getTaskMessages(taskId: string) {
  return db.query.taskMessages.findMany({
    where: eq(taskMessages.taskId, taskId),
    // Order by createdAt, then by id as tiebreaker for deterministic ordering
    orderBy: [taskMessages.createdAt, taskMessages.id],
  });
}
