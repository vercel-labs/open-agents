"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import {
  lastAssistantMessageIsCompleteWithApprovalResponses,
  DefaultChatTransport,
} from "ai";
import { useChat, type UseChatHelpers } from "@ai-sdk/react";
import type { WebAgentUIMessage } from "@/app/types";
import type { Task } from "@/lib/db/schema";
import type { DiffResponse } from "@/app/api/tasks/[id]/diff/route";
import type { FileSuggestion } from "@/app/api/tasks/[id]/files/route";
import type { ReconnectResponse } from "@/app/api/sandbox/reconnect/route";

export type SandboxInfo = {
  sandboxId: string;
  createdAt: number;
  timeout: number;
  currentBranch?: string;
};

export type ReconnectionStatus =
  | "idle"
  | "checking"
  | "connected"
  | "failed"
  | "no_sandbox";

type DiffCacheState = {
  data: DiffResponse | null;
  error: string | null;
  isLoading: boolean;
  /** The refreshKey value when this data was last fetched */
  lastFetchedKey: number;
};

type FileCacheState = {
  data: FileSuggestion[] | null;
  error: string | null;
  isLoading: boolean;
  /** The refreshKey value when this data was last fetched */
  lastFetchedKey: number;
};

type TaskChatContextValue = {
  task: Task;
  chat: UseChatHelpers<WebAgentUIMessage>;
  sandboxInfo: SandboxInfo | null;
  setSandboxInfo: (info: SandboxInfo) => void;
  clearSandboxInfo: () => void;
  archiveTask: () => Promise<void>;
  /** Whether the task had persisted messages when it was loaded */
  hadInitialMessages: boolean;
  /** Counter that increments when diff should be refreshed */
  diffRefreshKey: number;
  /** Trigger a diff refresh (invalidates cache) */
  triggerDiffRefresh: () => void;
  /** Cached diff state */
  diffCache: DiffCacheState;
  /** Fetch diff data (uses cache if valid) */
  fetchDiff: (sandboxId: string) => Promise<void>;
  /** Counter that increments when file list should be refreshed */
  fileRefreshKey: number;
  /** Trigger a file list refresh (invalidates cache) */
  triggerFileRefresh: () => void;
  /** Cached file list state */
  fileCache: FileCacheState;
  /** Fetch file list (uses cache if valid) */
  fetchFiles: (sandboxId: string) => Promise<void>;
  /** Update task snapshot info after saving */
  updateTaskSnapshot: (snapshotUrl: string, snapshotCreatedAt: Date) => void;
  /** Current status of sandbox reconnection attempt */
  reconnectionStatus: ReconnectionStatus;
  /** Attempt to reconnect to an existing sandbox */
  attemptReconnection: () => Promise<void>;
};

const TaskChatContext = createContext<TaskChatContextValue | undefined>(
  undefined,
);

type TaskChatProviderProps = {
  task: Task;
  initialMessages: WebAgentUIMessage[];
  children: ReactNode;
};

export function TaskChatProvider({
  task: initialTask,
  initialMessages,
  children,
}: TaskChatProviderProps) {
  const [task, setTask] = useState<Task>(initialTask);
  const sandboxIdRef = useRef<string | null>(initialTask.sandboxId ?? null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: () => ({
          sandboxId: sandboxIdRef.current,
          taskId: task.id,
        }),
      }),
    [task.id],
  );

  const chat = useChat<WebAgentUIMessage>({
    transport,
    messages: initialMessages,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });

  const [sandboxInfo, setSandboxInfoState] = useState<SandboxInfo | null>(null);

  const setSandboxInfo = useCallback((info: SandboxInfo) => {
    sandboxIdRef.current = info.sandboxId;
    setSandboxInfoState(info);
    // Keep task.sandboxId in sync so it doesn't become stale
    setTask((prev) => ({ ...prev, sandboxId: info.sandboxId }));
  }, []);

  const clearSandboxInfo = useCallback(() => {
    sandboxIdRef.current = null;
    setSandboxInfoState(null);
    // Keep task.sandboxId in sync so it doesn't become stale
    setTask((prev) => ({ ...prev, sandboxId: null }));
  }, []);

  const [reconnectionStatus, setReconnectionStatus] =
    useState<ReconnectionStatus>("idle");

  const attemptReconnection = useCallback(async () => {
    setReconnectionStatus("checking");

    try {
      const response = await fetch(
        `/api/sandbox/reconnect?taskId=${task.id}`,
      );

      if (!response.ok) {
        console.error("Reconnection request failed:", response.status);
        setReconnectionStatus("failed");
        return;
      }

      const data = (await response.json()) as ReconnectResponse;

      if (data.status === "connected") {
        sandboxIdRef.current = data.sandboxId;
        setSandboxInfoState({
          sandboxId: data.sandboxId,
          createdAt: data.createdAt,
          timeout: data.timeout,
        });
        setReconnectionStatus("connected");
      } else if (data.status === "no_sandbox") {
        // Clear stale sandboxId from local state
        sandboxIdRef.current = null;
        setTask((prev) => ({ ...prev, sandboxId: null }));
        setReconnectionStatus("no_sandbox");
      } else {
        // expired or not_found - server has already cleared sandbox metadata
        // Clear stale sandboxId from local state to prevent 403 errors on next sandbox creation
        sandboxIdRef.current = null;
        setTask((prev) => ({ ...prev, sandboxId: null }));
        setReconnectionStatus("failed");
      }
    } catch (error) {
      console.error("Failed to reconnect to sandbox:", error);
      setReconnectionStatus("failed");
    }
  }, [task.id]);

  const updateTaskSnapshot = useCallback(
    (snapshotUrl: string, snapshotCreatedAt: Date) => {
      setTask((prev) => ({ ...prev, snapshotUrl, snapshotCreatedAt }));
    },
    [],
  );

  const [diffRefreshKey, setDiffRefreshKey] = useState(0);

  const triggerDiffRefresh = useCallback(() => {
    setDiffRefreshKey((prev) => prev + 1);
  }, []);

  const [diffCache, setDiffCache] = useState<DiffCacheState>({
    data: null,
    error: null,
    isLoading: false,
    lastFetchedKey: -1, // -1 means never fetched
  });

  // Track the current fetch to prevent duplicates and handle race conditions
  const fetchCounterRef = useRef(0);
  const lastFetchedKeyRef = useRef<number>(-1);
  const fetchingKeyRef = useRef<number | null>(null);

  const fetchDiff = useCallback(
    async (sandboxId: string) => {
      // Skip if we already have data for this key or are already fetching it
      if (
        lastFetchedKeyRef.current === diffRefreshKey ||
        fetchingKeyRef.current === diffRefreshKey
      ) {
        return;
      }
      fetchingKeyRef.current = diffRefreshKey;

      // Increment counter and capture this fetch's ID
      const thisFetchId = ++fetchCounterRef.current;

      setDiffCache((prev) => ({
        ...prev,
        isLoading: true,
        error: null,
      }));

      try {
        const res = await fetch(
          `/api/tasks/${task.id}/diff?sandboxId=${sandboxId}`,
        );

        if (!res.ok) {
          const errorData = (await res.json()) as { error?: string };
          throw new Error(errorData.error ?? "Failed to fetch diff");
        }

        const data = (await res.json()) as DiffResponse;

        // Only update if this is still the latest fetch
        if (thisFetchId === fetchCounterRef.current) {
          lastFetchedKeyRef.current = diffRefreshKey;
          setDiffCache({
            data,
            error: null,
            isLoading: false,
            lastFetchedKey: diffRefreshKey,
          });
        }
        // If not the latest fetch, don't update - the newer fetch will handle it
      } catch (err) {
        // Only update if this is still the latest fetch
        if (thisFetchId === fetchCounterRef.current) {
          lastFetchedKeyRef.current = diffRefreshKey;
          setDiffCache((prev) => ({
            ...prev,
            error: err instanceof Error ? err.message : "Failed to fetch diff",
            isLoading: false,
            lastFetchedKey: diffRefreshKey,
          }));
        }
      }
    },
    [task.id, diffRefreshKey],
  );

  // File cache state (mirrors diff cache pattern)
  const [fileRefreshKey, setFileRefreshKey] = useState(0);

  const triggerFileRefresh = useCallback(() => {
    setFileRefreshKey((prev) => prev + 1);
  }, []);

  const [fileCache, setFileCache] = useState<FileCacheState>({
    data: null,
    error: null,
    isLoading: false,
    lastFetchedKey: -1,
  });

  const fileFetchCounterRef = useRef(0);
  const fileLastFetchedKeyRef = useRef<number>(-1);
  const fileFetchingKeyRef = useRef<number | null>(null);

  const fetchFiles = useCallback(
    async (sandboxId: string) => {
      if (
        fileLastFetchedKeyRef.current === fileRefreshKey ||
        fileFetchingKeyRef.current === fileRefreshKey
      ) {
        return;
      }
      fileFetchingKeyRef.current = fileRefreshKey;

      const thisFetchId = ++fileFetchCounterRef.current;

      setFileCache((prev) => ({
        ...prev,
        isLoading: true,
        error: null,
      }));

      try {
        const res = await fetch(
          `/api/tasks/${task.id}/files?sandboxId=${sandboxId}`,
        );

        if (!res.ok) {
          const errorData = (await res.json()) as { error?: string };
          throw new Error(errorData.error ?? "Failed to fetch files");
        }

        const data = (await res.json()) as { files: FileSuggestion[] };

        if (thisFetchId === fileFetchCounterRef.current) {
          fileLastFetchedKeyRef.current = fileRefreshKey;
          setFileCache({
            data: data.files,
            error: null,
            isLoading: false,
            lastFetchedKey: fileRefreshKey,
          });
        }
      } catch (err) {
        if (thisFetchId === fileFetchCounterRef.current) {
          fileLastFetchedKeyRef.current = fileRefreshKey;
          setFileCache((prev) => ({
            ...prev,
            error: err instanceof Error ? err.message : "Failed to fetch files",
            isLoading: false,
            lastFetchedKey: fileRefreshKey,
          }));
        }
      }
    },
    [task.id, fileRefreshKey],
  );

  const archiveTask = useCallback(async () => {
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });

    const data = (await res.json()) as { task?: Task; error?: string };

    if (!res.ok) {
      throw new Error(data.error ?? "Failed to archive task");
    }

    if (data.task) {
      setTask(data.task);
    }
  }, [task.id]);

  // Track whether we started with persisted messages (for initial message logic)
  const hadInitialMessages = initialMessages.length > 0;

  return (
    <TaskChatContext.Provider
      value={{
        task,
        chat,
        sandboxInfo,
        setSandboxInfo,
        clearSandboxInfo,
        archiveTask,
        hadInitialMessages,
        diffRefreshKey,
        triggerDiffRefresh,
        diffCache,
        fetchDiff,
        fileRefreshKey,
        triggerFileRefresh,
        fileCache,
        fetchFiles,
        updateTaskSnapshot,
        reconnectionStatus,
        attemptReconnection,
      }}
    >
      {children}
    </TaskChatContext.Provider>
  );
}

export function useTaskChatContext() {
  const context = useContext(TaskChatContext);
  if (!context) {
    throw new Error(
      "useTaskChatContext must be used within a TaskChatProvider",
    );
  }
  return context;
}
