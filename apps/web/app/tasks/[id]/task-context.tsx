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
import type { SandboxState } from "@open-harness/sandbox";
import type { DiffResponse } from "@/app/api/tasks/[id]/diff/route";
import type { CachedDiffResponse } from "@/app/api/tasks/[id]/diff/cached/route";
import type { FileSuggestion } from "@/app/api/tasks/[id]/files/route";
import type { ReconnectResponse } from "@/app/api/sandbox/reconnect/route";

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

type DiffCacheState = {
  data: DiffResponse | null;
  error: string | null;
  isLoading: boolean;
  /** The refreshKey value when this data was last fetched */
  lastFetchedKey: number;
  /** Whether this is stale cached data (sandbox offline) */
  isStale: boolean;
  /** When the cached data was saved (for stale data display) */
  cachedAt: Date | null;
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
  updateTaskTitle: (title: string) => Promise<void>;
  /** Whether the task had persisted messages when it was loaded */
  hadInitialMessages: boolean;
  /** Counter that increments when diff should be refreshed */
  diffRefreshKey: number;
  /** Trigger a diff refresh (invalidates cache) */
  triggerDiffRefresh: () => void;
  /** Cached diff state */
  diffCache: DiffCacheState;
  /** Fetch diff data (uses cache if valid, falls back to cached if offline) */
  fetchDiff: () => Promise<void>;
  /** Counter that increments when file list should be refreshed */
  fileRefreshKey: number;
  /** Trigger a file list refresh (invalidates cache) */
  triggerFileRefresh: () => void;
  /** Cached file list state */
  fileCache: FileCacheState;
  /** Fetch file list (uses cache if valid) */
  fetchFiles: () => Promise<void>;
  /** Update task snapshot info after saving */
  updateTaskSnapshot: (snapshotUrl: string, snapshotCreatedAt: Date) => void;
  /** Update sandbox type in task state */
  setSandboxType: (type: "just-bash" | "vercel" | "hybrid") => void;
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

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: () => ({
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
    setSandboxInfoState(info);
  }, []);

  const clearSandboxInfo = useCallback(() => {
    setSandboxInfoState(null);
    // Clear sandboxState to indicate no active sandbox
    setTask((prev) => ({ ...prev, sandboxState: null }));
  }, []);

  const [reconnectionStatus, setReconnectionStatus] =
    useState<ReconnectionStatus>("idle");

  const attemptReconnection = useCallback(async () => {
    setReconnectionStatus("checking");

    try {
      const response = await fetch(`/api/sandbox/reconnect?taskId=${task.id}`);

      if (!response.ok) {
        console.error("Reconnection request failed:", response.status);
        setReconnectionStatus("failed");
        return;
      }

      const data = (await response.json()) as ReconnectResponse;

      if (data.status === "connected") {
        // Sandbox is still alive - set info for UI
        // (actual sandbox connection happens server-side via task.sandboxState)
        setSandboxInfoState({
          createdAt: Date.now(),
          timeout: 300_000, // 5 minutes default for UI display
        });
        setReconnectionStatus("connected");
      } else if (data.status === "no_sandbox") {
        // No sandbox state exists
        setTask((prev) => ({ ...prev, sandboxState: null }));
        setReconnectionStatus("no_sandbox");
      } else {
        // expired or not_found - server has already cleared sandbox state
        setTask((prev) => ({ ...prev, sandboxState: null }));
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

  const setSandboxType = useCallback(
    (type: "just-bash" | "vercel" | "hybrid") => {
      setTask((prev) => {
        if (!prev.sandboxState) {
          // Create minimal sandboxState with just the type
          return {
            ...prev,
            sandboxState: { type } as SandboxState,
          };
        }
        return {
          ...prev,
          sandboxState: {
            ...prev.sandboxState,
            type,
          } as SandboxState,
        };
      });
    },
    [],
  );

  const [diffRefreshKey, setDiffRefreshKey] = useState(0);

  const triggerDiffRefresh = useCallback(() => {
    setDiffRefreshKey((prev) => prev + 1);
  }, []);

  // Initialize diff cache with task's cached diff if available (no layout shift)
  // Note: cachedDiff is stored as jsonb and cast to DiffResponse without runtime validation.
  // This is safe as long as the schema is only written by our own diff route.
  const [diffCache, setDiffCache] = useState<DiffCacheState>(() => {
    if (initialTask.cachedDiff) {
      return {
        data: initialTask.cachedDiff as DiffResponse,
        error: null,
        isLoading: false,
        lastFetchedKey: 0,
        isStale: true,
        cachedAt: initialTask.cachedDiffUpdatedAt ?? null,
      };
    }
    return {
      data: null,
      error: null,
      isLoading: false,
      lastFetchedKey: -1, // -1 means never fetched
      isStale: false,
      cachedAt: null,
    };
  });

  // Track the current fetch to prevent duplicates and handle race conditions
  const fetchCounterRef = useRef(0);
  // Initialize to 0 if we have cached data (matches lastFetchedKey in state)
  const lastFetchedKeyRef = useRef<number>(initialTask.cachedDiff ? 0 : -1);
  const fetchingKeyRef = useRef<number | null>(null);

  const fetchDiff = useCallback(async () => {
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

    // If no sandbox connected, go directly to cached endpoint
    if (!sandboxInfo) {
      try {
        const cachedRes = await fetch(`/api/tasks/${task.id}/diff/cached`);
        if (cachedRes.ok) {
          const cachedData = (await cachedRes.json()) as CachedDiffResponse;
          if (thisFetchId === fetchCounterRef.current) {
            lastFetchedKeyRef.current = diffRefreshKey;
            setDiffCache({
              data: cachedData.data,
              error: null,
              isLoading: false,
              lastFetchedKey: diffRefreshKey,
              isStale: true,
              cachedAt: new Date(cachedData.cachedAt),
            });
          }
          return;
        }
      } catch {
        // Ignore cached fetch errors
      }

      if (thisFetchId === fetchCounterRef.current) {
        lastFetchedKeyRef.current = diffRefreshKey;
        setDiffCache((prev) => ({
          ...prev,
          error: "No sandbox available and no cached diff",
          isLoading: false,
          lastFetchedKey: diffRefreshKey,
          isStale: false,
          cachedAt: null,
        }));
      }
      return;
    }

    try {
      const res = await fetch(`/api/tasks/${task.id}/diff`);

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
          isStale: false,
          cachedAt: null,
        });
        // Update local task state so cachedDiff is available when sandbox shuts down
        setTask((prev) => ({
          ...prev,
          cachedDiff: data,
          cachedDiffUpdatedAt: new Date(),
        }));
      }
      // If not the latest fetch, don't update - the newer fetch will handle it
    } catch (err) {
      // Try to load cached diff as fallback
      try {
        const cachedRes = await fetch(`/api/tasks/${task.id}/diff/cached`);
        if (cachedRes.ok) {
          const cachedData = (await cachedRes.json()) as CachedDiffResponse;
          if (thisFetchId === fetchCounterRef.current) {
            lastFetchedKeyRef.current = diffRefreshKey;
            setDiffCache({
              data: cachedData.data,
              error: null,
              isLoading: false,
              lastFetchedKey: diffRefreshKey,
              isStale: true,
              cachedAt: new Date(cachedData.cachedAt),
            });
          }
          return;
        }
      } catch {
        // Ignore cached fetch errors
      }

      // No cached data available - show original error
      if (thisFetchId === fetchCounterRef.current) {
        lastFetchedKeyRef.current = diffRefreshKey;
        setDiffCache((prev) => ({
          ...prev,
          error: err instanceof Error ? err.message : "Failed to fetch diff",
          isLoading: false,
          lastFetchedKey: diffRefreshKey,
          isStale: false,
          cachedAt: null,
        }));
      }
    }
  }, [task.id, diffRefreshKey, sandboxInfo]);

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

  const fetchFiles = useCallback(async () => {
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

    // If no sandbox connected, skip
    if (!sandboxInfo) {
      if (thisFetchId === fileFetchCounterRef.current) {
        fileLastFetchedKeyRef.current = fileRefreshKey;
        setFileCache((prev) => ({
          ...prev,
          error: "No sandbox available",
          isLoading: false,
          lastFetchedKey: fileRefreshKey,
        }));
      }
      return;
    }

    try {
      const res = await fetch(`/api/tasks/${task.id}/files`);

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
  }, [task.id, fileRefreshKey, sandboxInfo]);

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

  const updateTaskTitle = useCallback(
    async (title: string) => {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });

      const data = (await res.json()) as { task?: Task; error?: string };

      if (!res.ok) {
        throw new Error(data.error ?? "Failed to update task title");
      }

      if (data.task) {
        setTask(data.task);
      }
    },
    [task.id],
  );

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
        updateTaskTitle,
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
        setSandboxType,
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
