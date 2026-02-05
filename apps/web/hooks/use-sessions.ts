"use client";

import useSWR from "swr";
import type { Session } from "@/lib/db/schema";
import { fetcher } from "@/lib/swr";

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
  sessions: Session[];
}

interface CreateSessionResponse {
  session: Session;
  chat: { id: string };
}

export function useSessions(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const { data, error, isLoading, mutate } = useSWR<SessionsResponse>(
    enabled ? "/api/sessions" : null,
    fetcher,
  );

  const sessions = data?.sessions ?? [];

  const createSession = async (input: CreateSessionInput) => {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    const responseData = (await res.json()) as {
      session?: Session;
      chat?: { id: string };
      error?: string;
    };

    if (!res.ok || !responseData.session || !responseData.chat) {
      throw new Error(responseData.error ?? "Failed to create session");
    }

    const createdSession = responseData.session;
    const createdChat = responseData.chat;
    await mutate(
      {
        sessions: [createdSession, ...sessions],
      },
      { revalidate: false },
    );

    return {
      session: createdSession,
      chat: createdChat,
    } as CreateSessionResponse;
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
            s.id === sessionId ? updatedSession : s,
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
