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
  return task;
}

export async function deleteTask(taskId: string) {
  await db.delete(tasks).where(eq(tasks.id, taskId));
}

export async function createTaskMessage(data: NewTaskMessage) {
  const [message] = await db.insert(taskMessages).values(data).returning();
  return message;
}

export async function getTaskMessages(taskId: string) {
  return db.query.taskMessages.findMany({
    where: eq(taskMessages.taskId, taskId),
    orderBy: [taskMessages.createdAt],
  });
}
