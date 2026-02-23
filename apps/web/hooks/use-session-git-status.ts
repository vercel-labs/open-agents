"use client";

import useSWR from "swr";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toSessionGitStatus(value: unknown): SessionGitStatus {
  if (!isRecord(value)) {
    throw new Error("Invalid git status response");
  }

  const branch = asOptionalString(value.branch);
  if (!branch) {
    throw new Error("Invalid git status response");
  }

  return {
    branch,
    isDetachedHead: value.isDetachedHead === true,
    hasUncommittedChanges: value.hasUncommittedChanges === true,
    hasUnpushedCommits: value.hasUnpushedCommits === true,
    stagedCount: typeof value.stagedCount === "number" ? value.stagedCount : 0,
    unstagedCount:
      typeof value.unstagedCount === "number" ? value.unstagedCount : 0,
    untrackedCount:
      typeof value.untrackedCount === "number" ? value.untrackedCount : 0,
    uncommittedFiles:
      typeof value.uncommittedFiles === "number" ? value.uncommittedFiles : 0,
  };
}

export interface SessionGitStatus {
  branch: string;
  isDetachedHead: boolean;
  hasUncommittedChanges: boolean;
  hasUnpushedCommits: boolean;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  uncommittedFiles: number;
}

export interface UseSessionGitStatusReturn {
  gitStatus: SessionGitStatus | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<SessionGitStatus | undefined>;
}

async function fetchGitStatus(sessionId: string): Promise<SessionGitStatus> {
  const res = await fetch("/api/git-status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });

  if (!res.ok) {
    const error = new Error("Failed to fetch git status");
    try {
      const data: unknown = await res.json();
      if (isRecord(data)) {
        const message = asOptionalString(data.error);
        error.message = message ?? res.statusText;
      } else {
        error.message = res.statusText;
      }
    } catch {
      error.message = res.statusText;
    }
    throw error;
  }

  const data: unknown = await res.json();
  return toSessionGitStatus(data);
}

export function useSessionGitStatus(
  sessionId: string,
  sandboxConnected: boolean,
): UseSessionGitStatusReturn {
  const key = sandboxConnected ? (["git-status", sessionId] as const) : null;

  const { data, error, isLoading, mutate } = useSWR<SessionGitStatus>(
    key,
    async ([, id]: readonly [string, string]) => fetchGitStatus(id),
    {
      revalidateOnFocus: false,
      dedupingInterval: 1500,
    },
  );

  return {
    gitStatus: data ?? null,
    isLoading,
    error: error?.message ?? null,
    refresh: mutate,
  };
}
