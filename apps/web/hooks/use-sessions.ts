"use client";

import useSWR, { useSWRConfig } from "swr";
import type { Chat, Session } from "@/lib/db/schema";
import { fetcher } from "@/lib/swr";

export type SessionWithUnread = Session & {
  hasUnread: boolean;
  hasStreaming: boolean;
  latestChatId: string | null;
};

interface CreateSessionInput {
  title?: string;
  repoOwner?: string;
  repoName?: string;
  branch?: string;
  cloneUrl?: string;
  isNewBranch: boolean;
  sandboxType: "hybrid" | "vercel" | "just-bash";
}

interface SessionsResponse {
  sessions: SessionWithUnread[];
}

interface CreateSessionResponse {
  session: Session;
  chat: Chat;
}

export function useSessions(options?: {
  enabled?: boolean;
  initialData?: SessionsResponse;
}) {
  const enabled = options?.enabled ?? true;
  const { data, error, isLoading, mutate } = useSWR<SessionsResponse>(
    enabled ? "/api/sessions" : null,
    fetcher,
    {
      fallbackData: options?.initialData,
      revalidateOnMount: options?.initialData ? false : undefined,
    },
  );
  const { mutate: globalMutate } = useSWRConfig();

  const sessions = data?.sessions ?? [];

  const createSession = async (input: CreateSessionInput) => {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    const responseData = (await res.json()) as {
      session?: Session;
      chat?: Chat;
      error?: string;
    };

    if (!res.ok || !responseData.session || !responseData.chat) {
      throw new Error(responseData.error ?? "Failed to create session");
    }

    const createdSession = responseData.session;
    const createdChat = responseData.chat;

    void globalMutate(
      `/api/sessions/${createdSession.id}/chats`,
      {
        chats: [
          {
            ...createdChat,
            hasUnread: false,
            isStreaming: false,
          },
        ],
        defaultModelId: createdChat.modelId,
      },
      { revalidate: false },
    );

    await mutate(
      {
        sessions: [
          {
            ...createdSession,
            hasUnread: false,
            hasStreaming: false,
            latestChatId: createdChat.id,
          },
          ...sessions,
        ],
      },
      { revalidate: false },
    );

    return {
      session: createdSession,
      chat: createdChat,
    } satisfies CreateSessionResponse;
  };

  const archiveSession = async (sessionId: string) => {
    const res = await fetch(`/api/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });

    const responseData = (await res.json()) as {
      session?: Session;
      error?: string;
    };

    if (!res.ok) {
      throw new Error(responseData.error ?? "Failed to archive session");
    }

    if (responseData.session) {
      const updatedSession = responseData.session;
      await mutate(
        (current) => ({
          sessions: (current?.sessions ?? []).map((session) =>
            session.id === sessionId
              ? {
                  ...updatedSession,
                  hasUnread: session.hasUnread,
                  hasStreaming: session.hasStreaming,
                  latestChatId: session.latestChatId,
                }
              : session,
          ),
        }),
        { revalidate: true },
      );
    }

    return responseData.session;
  };

  return {
    sessions,
    loading: isLoading,
    error,
    createSession,
    archiveSession,
    refreshSessions: mutate,
  };
}
