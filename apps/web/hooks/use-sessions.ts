"use client";

import useSWR, { useSWRConfig } from "swr";
import type { Chat, Session } from "@/lib/db/schema";
import { fetcher } from "@/lib/swr";

export type SessionWithUnread = Pick<
  Session,
  | "id"
  | "title"
  | "status"
  | "repoName"
  | "branch"
  | "linesAdded"
  | "linesRemoved"
  | "prNumber"
  | "prStatus"
  | "createdAt"
> & {
  hasUnread: boolean;
  hasStreaming: boolean;
  latestChatId: string | null;
  lastActivityAt: Session["createdAt"];
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
  archivedCount?: number;
}

interface CreateSessionResponse {
  session: Session;
  chat: Chat;
}

export function useSessions(options?: {
  enabled?: boolean;
  includeArchived?: boolean;
  initialData?: SessionsResponse;
}) {
  const enabled = options?.enabled ?? true;
  const includeArchived = options?.includeArchived ?? true;
  const sessionsEndpoint = includeArchived
    ? "/api/sessions"
    : "/api/sessions?status=active";

  const { data, error, isLoading, mutate } = useSWR<SessionsResponse>(
    enabled ? "/api/sessions" : null,
    () => fetcher<SessionsResponse>(sessionsEndpoint),
    {
      fallbackData: options?.initialData,
      revalidateOnMount: options?.initialData ? false : undefined,
      refreshInterval: (latestData) => {
        const hasStreamingSession = latestData?.sessions.some(
          (s) => s.hasStreaming,
        );
        // Poll quickly while any session is streaming so we detect
        // completion promptly for background-chat notifications.
        return hasStreamingSession ? 3_000 : 0;
      },
    },
  );
  const { mutate: globalMutate } = useSWRConfig();

  const sessions = data?.sessions ?? [];
  const archivedCount = data?.archivedCount ?? 0;

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
      (current) => ({
        sessions: [
          {
            ...createdSession,
            hasUnread: false,
            hasStreaming: false,
            latestChatId: createdChat.id,
            lastActivityAt: createdChat.updatedAt,
          },
          ...(current?.sessions ?? []),
        ],
        archivedCount: current?.archivedCount,
      }),
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
        (current) => {
          if (!current) {
            return current;
          }

          if (!includeArchived) {
            const hadSession = current.sessions.some((s) => s.id === sessionId);
            return {
              ...current,
              sessions: current.sessions.filter((s) => s.id !== sessionId),
              archivedCount: hadSession
                ? (current.archivedCount ?? 0) + 1
                : current.archivedCount,
            };
          }

          return {
            ...current,
            sessions: current.sessions.map((session) =>
              session.id === sessionId
                ? {
                    ...updatedSession,
                    hasUnread: session.hasUnread,
                    hasStreaming: session.hasStreaming,
                    latestChatId: session.latestChatId,
                    lastActivityAt: session.lastActivityAt,
                  }
                : session,
            ),
          };
        },
        { revalidate: true },
      );
    }

    return responseData.session;
  };

  return {
    sessions,
    archivedCount,
    loading: isLoading,
    error,
    createSession,
    archiveSession,
    refreshSessions: mutate,
  };
}
