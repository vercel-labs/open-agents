"use client";

import useSWR, { useSWRConfig } from "swr";
import type { Chat, Session } from "@/lib/db/schema";
import { fetcher } from "@/lib/swr";

export type SessionWithUnread = Session & {
  hasUnread: boolean;
  hasStreaming: boolean;
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

export function useSessions(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const { data, error, isLoading, mutate } = useSWR<SessionsResponse>(
    enabled ? "/api/sessions" : null,
    fetcher,
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

    // Pre-seed the session chats SWR cache so the sidebar shows the
    // initial chat immediately on navigation instead of waiting for a
    // fresh fetch.
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
          { ...createdSession, hasUnread: false, hasStreaming: false },
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
          sessions: (current?.sessions ?? []).map((s) =>
            s.id === sessionId
              ? {
                  ...updatedSession,
                  hasUnread: s.hasUnread,
                  hasStreaming: s.hasStreaming,
                }
              : s,
          ),
        }),
        { revalidate: false },
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
