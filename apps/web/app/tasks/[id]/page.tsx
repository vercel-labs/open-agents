import { redirect, notFound } from "next/navigation";
import { getServerSession } from "@/lib/session/get-server-session";
import { getTaskById, getTaskMessages } from "@/lib/db/tasks";
import type { WebAgentUIMessage } from "@/app/types";
import { TaskChatProvider } from "./task-context";
import { TaskDetailContent } from "./task-detail-content";

interface TaskPageProps {
  params: Promise<{ id: string }>;
}

export default async function TaskPage({ params }: TaskPageProps) {
  const { id } = await params;

  // Server-side auth check
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }

  // Fetch task
  const task = await getTaskById(id);
  if (!task) {
    notFound();
  }

  // Check ownership
  if (task.userId !== session.user.id) {
    redirect("/");
  }

  // Fetch messages and transform to WebAgentUIMessage[]
  const dbMessages = await getTaskMessages(id);
  const initialMessages = dbMessages.map((m) => m.parts as WebAgentUIMessage);

  return (
    <TaskChatProvider task={task} initialMessages={initialMessages}>
      <TaskDetailContent />
    </TaskChatProvider>
  );
}
