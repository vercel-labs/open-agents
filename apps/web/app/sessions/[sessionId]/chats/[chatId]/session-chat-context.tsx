"use client";

import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { DefaultChatTransport, isToolUIPart } from "ai";
import { useChat, type UseChatHelpers } from "@ai-sdk/react";
import { useSWRConfig } from "swr";
import type { WebAgentUIMessage } from "@/app/types";
import type { Chat, Session } from "@/lib/db/schema";
import type { SandboxState } from "@open-harness/sandbox";
import type { DiffResponse } from "@/app/api/sessions/[sessionId]/diff/route";
import type { FileSuggestion } from "@/app/api/sessions/[sessionId]/files/route";
import type { ReconnectResponse } from "@/app/api/sandbox/reconnect/route";
import type { SandboxStatusResponse } from "@/app/api/sandbox/status/route";
import { useSessionDiff } from "@/hooks/use-session-diff";
import { useSessionFiles } from "@/hooks/use-session-files";

const KNOWN_SANDBOX_TYPES = ["just-bash", "vercel", "hybrid"] as const;
type KnownSandboxType = (typeof KNOWN_SANDBOX_TYPES)[number];

function asKnownSandboxType(value: unknown): KnownSandboxType | null {
  if (typeof value !== "string") return null;
  return KNOWN_SANDBOX_TYPES.includes(value as KnownSandboxType)
    ? (value as KnownSandboxType)
    : null;
}

function hasRuntimeSandboxData(state: unknown): boolean {
  if (!state || typeof state !== "object") return false;

  const sandboxState = state as {
    type?: unknown;
    sandboxId?: unknown;
    files?: unknown;
  };

  const sandboxType = asKnownSandboxType(sandboxState.type);
  if (!sandboxType) return false;

  if (sandboxType === "vercel") {
    return (
      typeof sandboxState.sandboxId === "string" &&
      sandboxState.sandboxId.length > 0
    );
  }

  if (sandboxType === "hybrid") {
    const hasSandboxId =
      typeof sandboxState.sandboxId === "string" &&
      sandboxState.sandboxId.length > 0;
    const hasFiles =
      sandboxState.files !== undefined && sandboxState.files !== null;
    return hasSandboxId || hasFiles;
  }

  return sandboxState.files !== undefined && sandboxState.files !== null;
}

export type SandboxInfo = {
  createdAt: number;
  timeout: number | null;
  currentBranch?: string;
};

export type ReconnectionStatus =
  | "idle"
  | "checking"
  | "connected"
  | "failed"
  | "no_sandbox";

export type LifecycleTimingInfo = {
  serverTimeMs: number;
  clockOffsetMs: number;
  state: Session["lifecycleState"] | null;
  lastActivityAtMs: number | null;
  hibernateAfterMs: number | null;
  sandboxExpiresAtMs: number | null;
};

export type SandboxStatusSyncResult = "active" | "no_sandbox" | "unknown";

function toMs(value: Date | null | undefined): number | null {
  return value ? value.getTime() : null;
}

type SessionChatContextValue = {
  session: Session;
  chatInfo: Chat;
  chat: UseChatHelpers<WebAgentUIMessage>;
  sandboxInfo: SandboxInfo | null;
  setSandboxInfo: (info: SandboxInfo) => void;
  clearSandboxInfo: () => void;
  archiveSession: () => Promise<void>;
  updateSessionTitle: (title: string) => Promise<void>;
  updateChatModel: (modelId: string) => Promise<void>;
  /** Whether the chat had persisted messages when it was loaded */
  hadInitialMessages: boolean;
  /** Diff data (from live sandbox or cache) */
  diff: DiffResponse | null;
  /** Whether diff is loading */
  diffLoading: boolean;
  /** Diff error message */
  diffError: string | null;
  /** Whether diff data is stale (from cache) */
  diffIsStale: boolean;
  /** When the cached diff was saved */
  diffCachedAt: Date | null;
  /** Trigger a diff refresh */
  refreshDiff: () => Promise<void>;
  /** File suggestions from sandbox */
  files: FileSuggestion[] | null;
  /** Whether files are loading */
  filesLoading: boolean;
  /** Files error message */
  filesError: string | null;
  /** Trigger a files refresh */
  refreshFiles: () => Promise<void>;
  /** Update session snapshot info after saving */
  updateSessionSnapshot: (snapshotUrl: string, snapshotCreatedAt: Date) => void;
  /** Preferred sandbox mode to request when creating a new sandbox */
  preferredSandboxType: string;
  /** Whether the current sandbox mode supports git diff */
  supportsDiff: boolean;
  /** Whether creating a repo is supported for the current sandbox mode */
  supportsRepoCreation: boolean;
  /** Whether session state currently has runtime sandbox data */
  hasRuntimeSandboxState: boolean;
  /** Whether the session currently has a saved snapshot available */
  hasSnapshot: boolean;
  /** Update sandbox type in session state if valid */
  setSandboxTypeFromUnknown: (type: unknown) => void;
  /** Current status of sandbox reconnection attempt */
  reconnectionStatus: ReconnectionStatus;
  /** Latest lifecycle timing snapshot from the server */
  lifecycleTiming: LifecycleTimingInfo;
  /** Refresh lifecycle status from DB without probing sandbox connectivity */
  syncSandboxStatus: () => Promise<SandboxStatusSyncResult>;
  /** Attempt to reconnect to an existing sandbox */
  attemptReconnection: () => Promise<ReconnectionStatus>;
};

const SessionChatContext = createContext<SessionChatContextValue | undefined>(
  undefined,
);

// Keep sandbox connection state across chat route transitions in the same session.
// This avoids flicker/loading indicators when switching chats that share one sandbox.
const sandboxInfoCache = new Map<string, SandboxInfo>();

/**
 * Custom predicate for auto-submitting messages.
 * Unlike the default `lastAssistantMessageIsCompleteWithApprovalResponses`,
 * this also checks for tools waiting in `input-available` state (e.g., AskUserQuestion).
 */
function shouldAutoSubmit({
  messages,
}: {
  messages: WebAgentUIMessage[];
}): boolean {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage.role !== "assistant") return false;

  // Find the last step-start to get tools from the current step only
  const lastStepStartIndex = lastMessage.parts.reduce(
    (lastIndex, part, index) =>
      part.type === "step-start" ? index : lastIndex,
    -1,
  );

  // Get tool invocations from the last step (non-provider-executed)
  const lastStepToolInvocations = lastMessage.parts
    .slice(lastStepStartIndex + 1)
    .filter(isToolUIPart)
    .filter((part) => !part.providerExecuted);

  // If no tool invocations, don't auto-submit
  if (lastStepToolInvocations.length === 0) return false;

  // Auto-submit only if ALL tools are in terminal state
  // Terminal states: output-available, output-error, approval-responded
  // NOT terminal: input-available (waiting for user input, e.g., AskUserQuestion)
  return lastStepToolInvocations.every(
    (part) =>
      part.state === "output-available" ||
      part.state === "output-error" ||
      part.state === "approval-responded",
  );
}

type SessionChatProviderProps = {
  session: Session;
  chat: Chat;
  initialMessages: WebAgentUIMessage[];
  children: ReactNode;
};

interface SessionsResponse {
  sessions: Session[];
}

export function SessionChatProvider({
  session: initialSession,
  chat: initialChat,
  initialMessages,
  children,
}: SessionChatProviderProps) {
  const { mutate } = useSWRConfig();
  const sessionId = initialSession.id;
  const [sessionRecord, setSessionRecord] = useState<Session>(initialSession);
  const [chatInfo, setChatInfo] = useState<Chat>(initialChat);
  const [hasSnapshotState, setHasSnapshotState] = useState<boolean>(
    !!initialSession.snapshotUrl,
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: () => ({
          sessionId: sessionRecord.id,
          chatId: chatInfo.id,
        }),
        prepareReconnectToStreamRequest: ({ id }) => ({
          api: `/api/chat/${id}/stream`,
        }),
      }),
    [sessionRecord.id, chatInfo.id],
  );

  const hadInitialMessages = initialMessages.length > 0;

  const chat = useChat<WebAgentUIMessage>({
    id: chatInfo.id,
    transport,
    messages: initialMessages,
    resume: !!initialChat.activeStreamId,
    sendAutomaticallyWhen: shouldAutoSubmit,
  });

  const [sandboxInfo, setSandboxInfoState] = useState<SandboxInfo | null>(
    () => sandboxInfoCache.get(sessionId) ?? null,
  );

  const setSandboxInfo = useCallback(
    (info: SandboxInfo) => {
      setSandboxInfoState(info);
      sandboxInfoCache.set(sessionId, info);
    },
    [sessionId],
  );

  const clearSandboxInfo = useCallback(() => {
    setSandboxInfoState(null);
    sandboxInfoCache.delete(sessionId);
    // Preserve the sandbox type for restoration, but clear other state
    setSessionRecord((prev) => ({
      ...prev,
      sandboxState: prev.sandboxState
        ? ({ type: prev.sandboxState.type } as SandboxState)
        : null,
    }));
  }, [sessionId]);

  const [reconnectionStatus, setReconnectionStatus] =
    useState<ReconnectionStatus>(() =>
      sandboxInfoCache.has(sessionId) ? "connected" : "idle",
    );
  const statusSyncRef = useRef<{
    lastAt: number;
    inFlight: Promise<SandboxStatusSyncResult> | null;
    lastResult: SandboxStatusSyncResult;
  }>({
    lastAt: 0,
    inFlight: null,
    lastResult: "unknown",
  });
  const [lifecycleTiming, setLifecycleTiming] = useState<LifecycleTimingInfo>(
    () => {
      const serverTimeMs = Date.now();
      return {
        serverTimeMs,
        clockOffsetMs: 0,
        state: initialSession.lifecycleState ?? null,
        lastActivityAtMs: toMs(initialSession.lastActivityAt),
        hibernateAfterMs: toMs(initialSession.hibernateAfter),
        sandboxExpiresAtMs: toMs(initialSession.sandboxExpiresAt),
      };
    },
  );

  const applyLifecycleTiming = useCallback(
    (
      lifecycle: ReconnectResponse["lifecycle"] | null | undefined,
      fallbackState?: Session["lifecycleState"] | null,
    ) => {
      const localNow = Date.now();
      if (!lifecycle) {
        setLifecycleTiming((prev) => ({
          ...prev,
          serverTimeMs: localNow,
          clockOffsetMs: 0,
          state: fallbackState ?? prev.state,
        }));
        return;
      }

      const serverTimeMs = lifecycle.serverTime;
      const clockOffsetMs = serverTimeMs - localNow;
      const state =
        (lifecycle.state as Session["lifecycleState"] | null) ?? null;

      setLifecycleTiming({
        serverTimeMs,
        clockOffsetMs,
        state,
        lastActivityAtMs: lifecycle.lastActivityAt,
        hibernateAfterMs: lifecycle.hibernateAfter,
        sandboxExpiresAtMs: lifecycle.sandboxExpiresAt,
      });

      setSessionRecord((prev) => ({
        ...prev,
        lifecycleState: state,
        lastActivityAt: lifecycle.lastActivityAt
          ? new Date(lifecycle.lastActivityAt)
          : null,
        hibernateAfter: lifecycle.hibernateAfter
          ? new Date(lifecycle.hibernateAfter)
          : null,
        sandboxExpiresAt: lifecycle.sandboxExpiresAt
          ? new Date(lifecycle.sandboxExpiresAt)
          : null,
      }));
    },
    [],
  );

  const attemptReconnection =
    useCallback(async (): Promise<ReconnectionStatus> => {
      setReconnectionStatus("checking");

      try {
        const response = await fetch(
          `/api/sandbox/reconnect?sessionId=${sessionRecord.id}`,
        );

        if (!response.ok) {
          console.error("Reconnection request failed:", response.status);
          setReconnectionStatus("failed");
          return "failed";
        }

        const data = (await response.json()) as ReconnectResponse;
        setHasSnapshotState(data.hasSnapshot);
        if (!data.hasSnapshot) {
          setSessionRecord((prev) => ({
            ...prev,
            snapshotUrl: null,
            snapshotCreatedAt: null,
          }));
        }
        applyLifecycleTiming(data.lifecycle);

        if (data.status === "connected") {
          // Calculate timeout from expiresAt if available, otherwise sandbox has no timeout
          const now = Date.now();
          const timeout = data.expiresAt ? data.expiresAt - now : null;
          const nextSandboxInfo = {
            createdAt: now,
            timeout,
          };
          setSandboxInfoState(nextSandboxInfo);
          sandboxInfoCache.set(sessionId, nextSandboxInfo);
          setReconnectionStatus("connected");
          return "connected";
        }

        if (data.status === "no_sandbox" || data.status === "expired") {
          setSandboxInfoState(null);
          sandboxInfoCache.delete(sessionId);
          // Preserve the sandbox type for restoration, but clear other state
          setSessionRecord((prev) => ({
            ...prev,
            sandboxState: prev.sandboxState
              ? ({ type: prev.sandboxState.type } as SandboxState)
              : null,
          }));
          setReconnectionStatus("no_sandbox");
          return "no_sandbox";
        }

        setSandboxInfoState(null);
        sandboxInfoCache.delete(sessionId);
        // Preserve the sandbox type for restoration, but clear other state
        setSessionRecord((prev) => ({
          ...prev,
          sandboxState: prev.sandboxState
            ? ({ type: prev.sandboxState.type } as SandboxState)
            : null,
        }));
        setReconnectionStatus("failed");
        return "failed";
      } catch (error) {
        console.error("Failed to reconnect to sandbox:", error);
        setSandboxInfoState(null);
        applyLifecycleTiming(null, "failed");
        setReconnectionStatus("failed");
        return "failed";
      }
    }, [sessionRecord.id, sessionId, applyLifecycleTiming]);

  const syncSandboxStatus =
    useCallback(async (): Promise<SandboxStatusSyncResult> => {
      const THROTTLE_MS = 5_000;
      const now = Date.now();

      if (statusSyncRef.current.inFlight) {
        return statusSyncRef.current.inFlight;
      }
      if (now - statusSyncRef.current.lastAt < THROTTLE_MS) {
        return statusSyncRef.current.lastResult;
      }

      const run = (async (): Promise<SandboxStatusSyncResult> => {
        try {
          const response = await fetch(
            `/api/sandbox/status?sessionId=${sessionRecord.id}`,
          );
          if (!response.ok) {
            return "unknown";
          }

          const data = (await response.json()) as SandboxStatusResponse;
          setHasSnapshotState(data.hasSnapshot);
          if (!data.hasSnapshot) {
            setSessionRecord((prev) => ({
              ...prev,
              snapshotUrl: null,
              snapshotCreatedAt: null,
            }));
          }
          applyLifecycleTiming(data.lifecycle);

          if (data.status === "no_sandbox") {
            setSandboxInfoState(null);
            sandboxInfoCache.delete(sessionId);
            setSessionRecord((prev) => ({
              ...prev,
              sandboxState: prev.sandboxState
                ? ({ type: prev.sandboxState.type } as SandboxState)
                : null,
            }));
            setReconnectionStatus((prev) =>
              prev === "checking" ? prev : "no_sandbox",
            );
            return "no_sandbox";
          }

          setSandboxInfoState((prev) => {
            const expiresAtMs = data.lifecycle.sandboxExpiresAt;
            if (expiresAtMs !== null) {
              const currentExpiresAt =
                prev && prev.timeout !== null
                  ? prev.createdAt + prev.timeout
                  : null;
              if (
                currentExpiresAt !== null &&
                Math.abs(currentExpiresAt - expiresAtMs) <= 1_000
              ) {
                return prev;
              }

              const nextTimeout = Math.max(0, expiresAtMs - Date.now());
              const nextSandboxInfo = {
                createdAt: Date.now(),
                timeout: nextTimeout,
              };
              sandboxInfoCache.set(sessionId, nextSandboxInfo);
              return nextSandboxInfo;
            }

            if (prev && prev.timeout === null) {
              return prev;
            }

            const nextSandboxInfo = {
              createdAt: Date.now(),
              timeout: null,
            };
            sandboxInfoCache.set(sessionId, nextSandboxInfo);
            return nextSandboxInfo;
          });
          setReconnectionStatus((prev) =>
            prev === "checking" ? prev : "connected",
          );
          return "active";
        } catch {
          // Best-effort poll; keep last known state on transient errors.
          return "unknown";
        }
      })();

      statusSyncRef.current.inFlight = run;

      try {
        const result = await run;
        statusSyncRef.current.lastAt = Date.now();
        statusSyncRef.current.lastResult = result;
        return result;
      } finally {
        statusSyncRef.current.inFlight = null;
      }
    }, [sessionRecord.id, sessionId, applyLifecycleTiming]);

  const updateSessionSnapshot = useCallback(
    (snapshotUrl: string, snapshotCreatedAt: Date) => {
      setHasSnapshotState(true);
      setSessionRecord((prev) => ({ ...prev, snapshotUrl, snapshotCreatedAt }));
    },
    [],
  );

  const setSandboxTypeFromUnknown = useCallback((type: unknown) => {
    const sandboxType = asKnownSandboxType(type);
    if (!sandboxType) return;

    setSessionRecord((prev) => {
      if (!prev.sandboxState) {
        return {
          ...prev,
          sandboxState: { type: sandboxType } as SandboxState,
        };
      }
      return {
        ...prev,
        sandboxState: {
          ...prev.sandboxState,
          type: sandboxType,
        } as SandboxState,
      };
    });
  }, []);

  const preferredSandboxType =
    asKnownSandboxType(sessionRecord.sandboxState?.type) ?? "hybrid";
  const supportsDiff = preferredSandboxType !== "just-bash";
  const supportsRepoCreation = preferredSandboxType !== "just-bash";
  const hasRuntimeSandboxState = hasRuntimeSandboxData(
    sessionRecord.sandboxState,
  );
  const hasSnapshot = hasSnapshotState || !!sessionRecord.snapshotUrl;

  // Use SWR hooks for diff and files
  const sandboxConnected = sandboxInfo !== null;

  // Note: cachedDiff is stored as jsonb and cast to DiffResponse without runtime validation.
  // This is safe as long as the schema is only written by our own diff route.
  const {
    diff,
    isLoading: diffLoading,
    error: diffError,
    isStale: diffIsStale,
    cachedAt: diffCachedAt,
    refresh: refreshDiffSWR,
  } = useSessionDiff(sessionRecord.id, sandboxConnected, {
    initialData: initialSession.cachedDiff as DiffResponse | null,
    initialCachedAt: initialSession.cachedDiffUpdatedAt ?? null,
  });

  const {
    files,
    isLoading: filesLoading,
    error: filesError,
    refresh: refreshFilesSWR,
  } = useSessionFiles(sessionRecord.id, sandboxConnected);

  // Update local session state when fresh diff data is received from the live sandbox.
  // This ensures cachedDiff is available when the sandbox disconnects.
  useEffect(() => {
    if (diff && !diffIsStale) {
      setSessionRecord((prev) => ({
        ...prev,
        cachedDiff: diff,
        cachedDiffUpdatedAt: new Date(),
      }));
    }
  }, [diff, diffIsStale]);

  const refreshDiff = useCallback(async () => {
    await refreshDiffSWR();
  }, [refreshDiffSWR]);

  const refreshFiles = useCallback(async () => {
    await refreshFilesSWR();
  }, [refreshFilesSWR]);

  const archiveSession = useCallback(async () => {
    const previousSession = sessionRecord;
    const optimisticSession: Session = {
      ...sessionRecord,
      status: "archived",
    };

    setSessionRecord(optimisticSession);
    await mutate<SessionsResponse>(
      "/api/sessions",
      (current) =>
        current
          ? {
              sessions: current.sessions.map((s) =>
                s.id === sessionRecord.id ? optimisticSession : s,
              ),
            }
          : current,
      { revalidate: false },
    );

    const res = await fetch(`/api/sessions/${sessionRecord.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });

    const data = (await res.json()) as { session?: Session; error?: string };

    if (!res.ok) {
      setSessionRecord(previousSession);
      await mutate<SessionsResponse>(
        "/api/sessions",
        (current) =>
          current
            ? {
                sessions: current.sessions.map((s) =>
                  s.id === sessionRecord.id ? previousSession : s,
                ),
              }
            : current,
        { revalidate: false },
      );
      throw new Error(data.error ?? "Failed to archive session");
    }

    const nextSession = data.session ?? optimisticSession;
    setSessionRecord(nextSession);
    await mutate<SessionsResponse>(
      "/api/sessions",
      (current) =>
        current
          ? {
              sessions: current.sessions.map((s) =>
                s.id === sessionRecord.id ? nextSession : s,
              ),
            }
          : current,
      { revalidate: false },
    );
  }, [sessionRecord, mutate]);

  const updateSessionTitle = useCallback(
    async (title: string) => {
      const res = await fetch(`/api/sessions/${sessionRecord.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });

      const data = (await res.json()) as { session?: Session; error?: string };

      if (!res.ok) {
        throw new Error(data.error ?? "Failed to update session title");
      }

      if (data.session) {
        setSessionRecord(data.session);
      }
    },
    [sessionRecord.id],
  );

  const updateChatModel = useCallback(
    async (modelId: string) => {
      const res = await fetch(
        `/api/sessions/${sessionRecord.id}/chats/${chatInfo.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ modelId }),
        },
      );

      const data = (await res.json()) as { chat?: Chat; error?: string };
      if (!res.ok || !data.chat) {
        throw new Error(data.error ?? "Failed to update chat model");
      }

      setChatInfo(data.chat);
    },
    [sessionRecord.id, chatInfo.id],
  );

  return (
    <SessionChatContext.Provider
      value={{
        session: sessionRecord,
        chatInfo,
        chat,
        sandboxInfo,
        setSandboxInfo,
        clearSandboxInfo,
        archiveSession,
        updateSessionTitle,
        updateChatModel,
        hadInitialMessages,
        diff,
        diffLoading,
        diffError,
        diffIsStale,
        diffCachedAt,
        refreshDiff,
        files,
        filesLoading,
        filesError,
        refreshFiles,
        updateSessionSnapshot,
        preferredSandboxType,
        supportsDiff,
        supportsRepoCreation,
        hasRuntimeSandboxState,
        hasSnapshot,
        setSandboxTypeFromUnknown,
        reconnectionStatus,
        lifecycleTiming,
        syncSandboxStatus,
        attemptReconnection,
      }}
    >
      {children}
    </SessionChatContext.Provider>
  );
}

export function useSessionChatContext() {
  const context = useContext(SessionChatContext);
  if (!context) {
    throw new Error(
      "useSessionChatContext must be used within a SessionChatProvider",
    );
  }
  return context;
}
