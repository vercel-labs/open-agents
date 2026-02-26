import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { WebAgentUIMessage } from "@/app/types";
import { DiffsProvider } from "@/components/diffs-provider";
import { getChatById, getChatMessages } from "@/lib/db/sessions";
import { getSessionByIdCached } from "@/lib/db/sessions-cache";
import type { AvailableModel } from "@/lib/models";
import { getServerSession } from "@/lib/session/get-server-session";
import { SessionChatContent } from "./session-chat-content";
import { SessionChatProvider } from "./session-chat-context";

interface SessionChatPageProps {
  params: Promise<{ sessionId: string; chatId: string }>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isOptimisticChatId(chatId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    chatId,
  );
}

const OPTIMISTIC_CHAT_RETRY_DELAY_MS = 100;
const OPTIMISTIC_CHAT_RETRY_ATTEMPTS = 50;

interface ModelsResponse {
  models: AvailableModel[];
}

async function getInitialModels(): Promise<AvailableModel[]> {
  try {
    const requestHeaders = await headers();
    const host =
      requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");

    if (!host) {
      return [];
    }

    const protocol =
      requestHeaders.get("x-forwarded-proto") ??
      (host.includes("localhost") ? "http" : "https");

    const response = await fetch(`${protocol}://${host}/api/models`, {
      next: { revalidate: 3600 },
    });

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as ModelsResponse;
    return data.models ?? [];
  } catch {
    return [];
  }
}

async function getChatByIdWithRetry(
  chatId: string,
  sessionId: string,
): Promise<Awaited<ReturnType<typeof getChatById>>> {
  const maxAttempts = isOptimisticChatId(chatId)
    ? OPTIMISTIC_CHAT_RETRY_ATTEMPTS
    : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const chat = await getChatById(chatId);
    if (chat && chat.sessionId === sessionId) {
      return chat;
    }
    if (attempt < maxAttempts) {
      await sleep(OPTIMISTIC_CHAT_RETRY_DELAY_MS);
    }
  }
  return undefined;
}

export async function generateMetadata({
  params,
}: SessionChatPageProps): Promise<Metadata> {
  const { sessionId } = await params;
  const sessionRecord = await getSessionByIdCached(sessionId);

  return {
    title: sessionRecord?.title ?? `Session ${sessionId}`,
    description: "Review session progress, chats, and outputs.",
  };
}

export default async function SessionChatPage({
  params,
}: SessionChatPageProps) {
  const { sessionId, chatId } = await params;

  // Start independent fetches in parallel
  const sessionPromise = getServerSession();
  const sessionRecordPromise = getSessionByIdCached(sessionId);

  // Server-side auth check
  const session = await sessionPromise;
  if (!session?.user) {
    redirect("/");
  }

  // Fetch session record
  const sessionRecord = await sessionRecordPromise;
  if (!sessionRecord) {
    notFound();
  }

  // Check ownership
  if (sessionRecord.userId !== session.user.id) {
    redirect("/");
  }

  // Fetch chat, messages, and models in parallel
  const [chat, dbMessages, initialModels] = await Promise.all([
    getChatByIdWithRetry(chatId, sessionId),
    getChatMessages(chatId),
    getInitialModels(),
  ]);
  if (!chat) {
    if (isOptimisticChatId(chatId)) {
      redirect(`/sessions/${sessionId}`);
    }
    notFound();
  }
  const initialMessages = dbMessages.map((m) => m.parts as WebAgentUIMessage);
  return (
    <DiffsProvider>
      <SessionChatProvider
        session={sessionRecord}
        chat={chat}
        initialMessages={initialMessages}
      >
        <SessionChatContent initialModels={initialModels} />
      </SessionChatProvider>
    </DiffsProvider>
  );
}
