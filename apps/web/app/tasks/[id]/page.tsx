import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { WebAgentUIMessage } from "@/app/types";
import { getTaskById, getTaskMessages } from "@/lib/db/tasks";
import { getServerSession } from "@/lib/session/get-server-session";
import { TaskChatProvider } from "./task-context";
import { TaskDetailContent } from "./task-detail-content";

interface TaskPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: TaskPageProps): Promise<Metadata> {
  const { id } = await params;

  return {
    title: `Task ${id}`,
    description: "Review task progress, messages, and outputs.",
  };
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
