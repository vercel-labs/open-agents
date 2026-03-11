"use client";

import { type UseChatHelpers, useChat } from "@ai-sdk/react";
import type { SandboxState } from "@open-harness/sandbox";
import { isToolUIPart } from "ai";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSWRConfig } from "swr";
import type { ReconnectResponse } from "@/app/api/sandbox/reconnect/route";
import type { SandboxStatusResponse } from "@/app/api/sandbox/status/route";
import type { DiffResponse } from "@/app/api/sessions/[sessionId]/diff/route";
import type { FileSuggestion } from "@/app/api/sessions/[sessionId]/files/route";
import type { SkillSuggestion } from "@/app/api/sessions/[sessionId]/skills/route";
import type { WebAgentUIMessage } from "@/app/types";
import { useModelOptions } from "@/hooks/use-model-options";
import { useSessionDiff } from "@/hooks/use-session-diff";
import { useSessionFiles } from "@/hooks/use-session-files";
import {
  type SessionGitStatus,
  useSessionGitStatus,
} from "@/hooks/use-session-git-status";
import { useSessionSkills } from "@/hooks/use-session-skills";
import { AbortableChatTransport } from "@/lib/abortable-chat-transport";
import {
  abortChatInstanceTransport,
  getOrCreateChatInstance,
} from "@/lib/chat-instance-manager";
import { cleanupChatRouteOnUnmount } from "@/lib/chat-route-cleanup";
import type { Chat, Session } from "@/lib/db/schema";
import { type ModelOption, withMissingModelOption } from "@/lib/model-options";
import { hasRuntimeSandboxState as hasRuntimeSandboxStateValue } from "@/lib/sandbox/utils";

const KNOWN_SANDBOX_TYPES = ["vercel"] as const;
type KnownSandboxType = (typeof KNOWN_SANDBOX_TYPES)[number];
const CHAT_UI_UPDATE_THROTTLE_MS = 75;

function asKnownSandboxType(value: unknown): KnownSandboxType | null {
  if (typeof value !== "string") return null;
  return KNOWN_SANDBOX_TYPES.includes(value as KnownSandboxType)
    ? (value as KnownSandboxType)
    : null;
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

type RetryChatStreamOptions = {
  auto?: boolean;
  strategy?: "hard" | "soft";
};

function toMs(value: Date | null | undefined): number | null {
  return value ? value.getTime() : null;
}

function toPositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : null;
}

function resolveContextLimitForModel(
  modelOptions: ModelOption[] | undefined,
  modelId: string | null | undefined,
): number | null {
  if (!modelOptions || !modelId) {
    return null;
  }

  const selectedModel = modelOptions.find((model) => model.id === modelId);
  return toPositiveInteger(selectedModel?.contextWindow);
}

type SessionChatContextValue = {
  session: Session;
  chatInfo: Chat;
  chat: UseChatHelpers<WebAgentUIMessage>;
  contextLimit: number | null;
  stopChatStream: () => void;
  sandboxInfo: SandboxInfo | null;
  setSandboxInfo: (info: SandboxInfo) => void;
  clearSandboxInfo: () => void;
  archiveSession: () => Promise<void>;
  unarchiveSession: () => Promise<void>;
  updateSessionTitle: (title: string) => Promise<void>;
  updateChatModel: (modelId: string) => Promise<void>;
  /** Whether the chat had persisted messages when it was loaded */
  hadInitialMessages: boolean;
  /** The initial message snapshot used for SSR hydration */
  initialMessages: WebAgentUIMessage[];
  /** Diff data (from live sandbox or cache) */
  diff: DiffResponse | null;
  /** Whether diff is loading */
  diffLoading: boolean;
  /** Whether a diff refresh/revalidation is in progress */
  diffRefreshing: boolean;
  /** Diff error message */
  diffError: string | null;
  /** Whether diff data is stale (from cache) */
  diffIsStale: boolean;
  /** When the cached diff was saved */
  diffCachedAt: Date | null;
  /** Trigger a diff refresh */
  refreshDiff: () => Promise<void>;
  /** Git status for the current session workspace */
  gitStatus: SessionGitStatus | null;
  /** Whether git status is loading */
  gitStatusLoading: boolean;
  /** Git status error message */
  gitStatusError: string | null;
  /** Trigger a git status refresh */
  refreshGitStatus: () => Promise<SessionGitStatus | undefined>;
  /** File suggestions from sandbox */
  files: FileSuggestion[] | null;
  /** Whether files are loading */
  filesLoading: boolean;
  /** Files error message */
  filesError: string | null;
  /** Trigger a files refresh */
  refreshFiles: () => Promise<void>;
  /** Skill suggestions from sandbox */
  skills: SkillSuggestion[] | null;
  /** Whether skills are loading */
  skillsLoading: boolean;
  /** Skills error message */
  skillsError: string | null;
  /** Trigger a skills refresh */
  refreshSkills: () => Promise<void>;
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
  /** Clear a transient chat error and attempt to resume an active stream */
  retryChatStream: (opts?: RetryChatStreamOptions) => void;
  /** Update session repo info after creating a repo */
  updateSessionRepo: (info: {
    cloneUrl: string;
    repoOwner: string;
    repoName: string;
    branch: string;
  }) => void;
  /** Update local PR metadata after creating/discovering a PR */
  updateSessionPullRequest: (info: {
    prNumber: number;
    prStatus: "open" | "merged" | "closed";
  }) => void;
  /** Check sandbox branch and look for existing PRs, persisting to DB */
  checkBranchAndPr: () => Promise<void>;
  /** Available model options (base models + variants) */
  modelOptions: ModelOption[];
  /** Whether model options are still loading */
  modelOptionsLoading: boolean;
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
  initialModelOptions: ModelOption[];
  children: ReactNode;
};

interface SessionsResponse {
  sessions: (Session & { hasUnread?: boolean })[];
}

export function SessionChatProvider({
  session: initialSession,
  chat: initialChat,
  initialMessages,
  initialModelOptions,
  children,
}: SessionChatProviderProps) {
  const { mutate } = useSWRConfig();
  const sessionId = initialSession.id;
  const [sessionRecord, setSessionRecord] = useState<Session>(initialSession);
  const [chatInfo, setChatInfo] = useState<Chat>(initialChat);
  const [hasSnapshotState, setHasSnapshotState] = useState<boolean>(
    !!initialSession.snapshotUrl,
  );
  const {
    modelOptions: baseModelOptions,
    loading: modelOptionsLoadingFromApi,
  } = useModelOptions({
    initialModelOptions,
  });
  const modelOptions = useMemo(
    () => withMissingModelOption(baseModelOptions, chatInfo.modelId),
    [baseModelOptions, chatInfo.modelId],
  );
  const modelOptionsLoading =
    modelOptions.length === 0 && modelOptionsLoadingFromApi;
  const contextLimit = useMemo(
    () => resolveContextLimitForModel(modelOptions, chatInfo.modelId ?? null),
    [modelOptions, chatInfo.modelId],
  );
  const contextLimitRef = useRef<number | null>(contextLimit);

  useEffect(() => {
    contextLimitRef.current = contextLimit;
  }, [contextLimit]);

  const transport = useMemo(
    () =>
      new AbortableChatTransport({
        api: "/api/chat",
        body: () => {
          const requestContextLimit = contextLimitRef.current;
          return {
            sessionId: sessionRecord.id,
            chatId: chatInfo.id,
            ...(requestContextLimit !== null
              ? {
                  context: {
                    contextLimit: requestContextLimit,
                  },
                }
              : {}),
          };
        },
        prepareReconnectToStreamRequest: ({ id }) => ({
          api: `/api/chat/${id}/stream`,
        }),
      }),
    [sessionRecord.id, chatInfo.id],
  );

  const hadInitialMessages = initialMessages.length > 0;

  const { instance: chatInstance, alreadyExisted } = useMemo(
    () =>
      getOrCreateChatInstance(chatInfo.id, {
        id: chatInfo.id,
        transport,
        messages: initialMessages,
        sendAutomaticallyWhen: shouldAutoSubmit,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only create once per chatId; init values are only used at creation time
    [chatInfo.id],
  );

  // Track explicit user-initiated stops so auto-recovery doesn't immediately
  // reconnect to the still-running server stream (the main cause of the
  // "need to tap stop 3 times on iOS" bug).
  const userStoppedRef = useRef(false);

  const stopChatStream = useCallback(() => {
    userStoppedRef.current = true;
    void chatInstance.stop();
    abortChatInstanceTransport(chatInfo.id);
  }, [chatInfo.id, chatInstance]);

  // Compute resume only once on mount. If this tracks `chatInstance.status`
  // reactively, transient ready/submitted transitions during tool loops can
  // retrigger `resumeStream()` and replay recent chunks on top of the live
  // stream, causing visible jank.
  const shouldResumeOnMountRef = useRef(
    !!initialChat.activeStreamId &&
      (!alreadyExisted ||
        chatInstance.status === "ready" ||
        chatInstance.status === "error"),
  );

  const chat = useChat<WebAgentUIMessage>({
    chat: chatInstance,
    resume: shouldResumeOnMountRef.current,
    experimental_throttle: CHAT_UI_UPDATE_THROTTLE_MS,
  });

  /**
   * Clear a transient chat error (e.g. iOS "Load failed") and attempt to
   * resume the server-side stream if one is still active.
   *
   * When called from a manual "Retry" button we always want to reconnect, so
   * the stopped flag is reset.  When called from the automatic
   * visibility-change / online recovery handler, the flag is checked first so
   * that a user-initiated stop is respected and the stream is not silently
   * restarted.
   */
  const retryChatStream = useCallback(
    (opts?: RetryChatStreamOptions) => {
      const strategy = opts?.strategy ?? "hard";
      // If the user explicitly stopped the stream, don't auto-reconnect.
      // This prevents the "tap stop 3 times" loop on iOS where aborting the
      // transport causes a transient error that the auto-recovery immediately
      // reconnects.
      if (opts?.auto && userStoppedRef.current) {
        // Still clear the error so the UI doesn't show a stale error banner.
        chat.clearError();
        return;
      }
      // Manual retry — reset the flag so the stream can proceed.
      userStoppedRef.current = false;
      if (strategy === "hard") {
        // Tear down any stale local fetch before reconnecting.
        void chatInstance.stop();
        abortChatInstanceTransport(chatInfo.id);
      }
      // Clear the error so the chat UI becomes visible again.
      chat.clearError();
      // If the server-side stream is still running, reconnect to it.
      void chat.resumeStream();
    },
    [chat, chatInfo.id, chatInstance],
  );

  // Reset the user-stopped flag when a new message is sent so that
  // auto-recovery works normally for the new stream.
  useEffect(() => {
    if (chat.status === "submitted") {
      userStoppedRef.current = false;
    }
  }, [chat.status]);

  // Cleanup: release per-route chat instances and abort local transport
  // connections so unmounted routes do not keep consuming client resources.
  //
  // Important: do NOT call chatInstance.stop() during route teardown.
  // stop() publishes a server stop signal; when users leave the page during
  // long-running tool/subagent work that would cancel generation and drop
  // persistence. We only stop explicitly via the UI stop action.
  useEffect(() => {
    return () => {
      cleanupChatRouteOnUnmount(chatInfo.id);
    };
  }, [chatInfo.id]);

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

  const updateSessionRepo = useCallback(
    (info: {
      cloneUrl: string;
      repoOwner: string;
      repoName: string;
      branch: string;
    }) => {
      setSessionRecord((prev) => ({
        ...prev,
        cloneUrl: info.cloneUrl,
        repoOwner: info.repoOwner,
        repoName: info.repoName,
        branch: info.branch,
      }));
    },
    [],
  );

  const updateSessionPullRequest = useCallback(
    (info: { prNumber: number; prStatus: "open" | "merged" | "closed" }) => {
      setSessionRecord((prev) => ({
        ...prev,
        prNumber: info.prNumber,
        prStatus: info.prStatus,
      }));

      void mutate<SessionsResponse>(
        "/api/sessions",
        (current) =>
          current
            ? {
                ...current,
                sessions: current.sessions.map((s) =>
                  s.id === sessionId
                    ? {
                        ...s,
                        prNumber: info.prNumber,
                        prStatus: info.prStatus,
                      }
                    : s,
                ),
              }
            : current,
        { revalidate: false },
      );
    },
    [mutate, sessionId],
  );

  const checkBranchAndPr = useCallback(async () => {
    // Only check if the session has repo info. The API will return a 400
    // if the sandbox is not active, which we silently ignore.
    if (!sessionRecord.repoOwner || !sessionRecord.repoName) return;

    try {
      const res = await fetch("/api/check-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionRecord.id }),
      });
      if (!res.ok) return;

      const data = (await res.json()) as {
        branch: string | null;
        prNumber: number | null;
        prStatus: "open" | "merged" | "closed" | null;
      };
      const nextPrFields =
        data.prNumber && data.prStatus
          ? { prNumber: data.prNumber, prStatus: data.prStatus }
          : { prNumber: null, prStatus: null };

      // Update local session state with branch and PR info
      setSessionRecord((prev) => ({
        ...prev,
        ...(data.branch ? { branch: data.branch } : {}),
        ...nextPrFields,
      }));

      // Optimistically update the sessions list cache so sidebar reflects changes
      void mutate<SessionsResponse>(
        "/api/sessions",
        (current) =>
          current
            ? {
                ...current,
                sessions: current.sessions.map((s) =>
                  s.id === sessionId
                    ? {
                        ...s,
                        ...(data.branch ? { branch: data.branch } : {}),
                        ...nextPrFields,
                      }
                    : s,
                ),
              }
            : current,
        { revalidate: false },
      );
    } catch (error) {
      console.error("Failed to check branch/PR:", error);
    }
  }, [
    sessionRecord.id,
    sessionRecord.repoOwner,
    sessionRecord.repoName,
    mutate,
    sessionId,
  ]);

  // When entering a session on a branch that already has a PR, hydrate PR
  // metadata as soon as we know the sandbox is connected so the header action
  // reflects existing PR state immediately.
  useEffect(() => {
    if (sessionRecord.prNumber != null) return;
    if (!sessionRecord.repoOwner || !sessionRecord.repoName) return;
    if (reconnectionStatus !== "connected") return;

    void checkBranchAndPr();
  }, [
    sessionRecord.prNumber,
    sessionRecord.repoOwner,
    sessionRecord.repoName,
    reconnectionStatus,
    checkBranchAndPr,
  ]);

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
    asKnownSandboxType(sessionRecord.sandboxState?.type) ?? "vercel";
  const supportsDiff =
    sessionRecord.sandboxState?.type === undefined ||
    sessionRecord.sandboxState.type === "vercel";
  const supportsRepoCreation =
    sessionRecord.sandboxState?.type === undefined ||
    sessionRecord.sandboxState.type === "vercel";
  const hasRuntimeSandboxState = hasRuntimeSandboxStateValue(
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
    isValidating: diffRefreshing,
    error: diffError,
    isStale: diffIsStale,
    cachedAt: diffCachedAt,
    refresh: refreshDiffSWR,
  } = useSessionDiff(sessionRecord.id, sandboxConnected, {
    initialData: initialSession.cachedDiff as DiffResponse | null,
    initialCachedAt: initialSession.cachedDiffUpdatedAt ?? null,
  });

  const {
    gitStatus,
    isLoading: gitStatusLoading,
    error: gitStatusError,
    refresh: refreshGitStatusSWR,
  } = useSessionGitStatus(sessionRecord.id, sandboxConnected);

  const {
    files,
    isLoading: filesLoading,
    error: filesError,
    refresh: refreshFilesSWR,
  } = useSessionFiles(sessionRecord.id, sandboxConnected);

  const {
    skills,
    isLoading: skillsLoading,
    error: skillsError,
    refresh: refreshSkillsSWR,
  } = useSessionSkills(sessionRecord.id, sandboxConnected);

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

  const refreshGitStatus = useCallback(async () => {
    return refreshGitStatusSWR();
  }, [refreshGitStatusSWR]);

  const refreshFiles = useCallback(async () => {
    await refreshFilesSWR();
  }, [refreshFilesSWR]);

  const refreshSkills = useCallback(async () => {
    await refreshSkillsSWR();
  }, [refreshSkillsSWR]);

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
              ...current,
              sessions: current.sessions.map((s) =>
                s.id === sessionRecord.id
                  ? { ...optimisticSession, hasUnread: s.hasUnread }
                  : s,
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
                ...current,
                sessions: current.sessions.map((s) =>
                  s.id === sessionRecord.id
                    ? { ...previousSession, hasUnread: s.hasUnread }
                    : s,
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
              ...current,
              sessions: current.sessions.map((s) =>
                s.id === sessionRecord.id
                  ? { ...nextSession, hasUnread: s.hasUnread }
                  : s,
              ),
            }
          : current,
      { revalidate: true },
    );
  }, [sessionRecord, mutate]);

  const unarchiveSession = useCallback(async () => {
    // Wait for server confirmation before updating local state so that
    // sandbox-related effects (reconnect probe, auto-restore, auto-create)
    // don't fire until the server has actually reset the session.
    const res = await fetch(`/api/sessions/${sessionRecord.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "running" }),
    });

    const data = (await res.json()) as { session?: Session; error?: string };

    if (!res.ok) {
      throw new Error(data.error ?? "Failed to unarchive session");
    }

    const nextSession: Session = data.session ?? {
      ...sessionRecord,
      status: "running",
      lifecycleState: null,
    };
    setSessionRecord(nextSession);
    await mutate<SessionsResponse>(
      "/api/sessions",
      (current) =>
        current
          ? {
              ...current,
              sessions: current.sessions.map((s) =>
                s.id === sessionRecord.id
                  ? { ...nextSession, hasUnread: s.hasUnread }
                  : s,
              ),
            }
          : current,
      { revalidate: true },
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

      const nextSession = data.session ?? { ...sessionRecord, title };
      setSessionRecord(nextSession);
      await mutate<SessionsResponse>(
        "/api/sessions",
        (current) =>
          current
            ? {
                ...current,
                sessions: current.sessions.map((s) =>
                  s.id === sessionRecord.id ? { ...s, ...nextSession } : s,
                ),
              }
            : current,
        { revalidate: false },
      );
    },
    [sessionRecord, mutate],
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

  const contextValue = useMemo(
    () => ({
      session: sessionRecord,
      chatInfo,
      chat,
      contextLimit,
      stopChatStream,
      retryChatStream,
      sandboxInfo,
      setSandboxInfo,
      clearSandboxInfo,
      archiveSession,
      unarchiveSession,
      updateSessionTitle,
      updateChatModel,
      hadInitialMessages,
      initialMessages,
      diff,
      diffLoading,
      diffRefreshing,
      diffError,
      diffIsStale,
      diffCachedAt,
      refreshDiff,
      gitStatus,
      gitStatusLoading,
      gitStatusError,
      refreshGitStatus,
      files,
      filesLoading,
      filesError,
      refreshFiles,
      skills,
      skillsLoading,
      skillsError,
      refreshSkills,
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
      updateSessionRepo,
      updateSessionPullRequest,
      checkBranchAndPr,
      modelOptions,
      modelOptionsLoading,
    }),
    [
      sessionRecord,
      chatInfo,
      chat,
      contextLimit,
      stopChatStream,
      retryChatStream,
      sandboxInfo,
      setSandboxInfo,
      clearSandboxInfo,
      archiveSession,
      unarchiveSession,
      updateSessionTitle,
      updateChatModel,
      hadInitialMessages,
      initialMessages,
      diff,
      diffLoading,
      diffRefreshing,
      diffError,
      diffIsStale,
      diffCachedAt,
      refreshDiff,
      gitStatus,
      gitStatusLoading,
      gitStatusError,
      refreshGitStatus,
      files,
      filesLoading,
      filesError,
      refreshFiles,
      skills,
      skillsLoading,
      skillsError,
      refreshSkills,
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
      updateSessionRepo,
      updateSessionPullRequest,
      checkBranchAndPr,
      modelOptions,
      modelOptionsLoading,
    ],
  );

  return (
    <SessionChatContext.Provider value={contextValue}>
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
