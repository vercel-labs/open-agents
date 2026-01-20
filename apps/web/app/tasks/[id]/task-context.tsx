"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
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
import type { FileSuggestion } from "@/app/api/tasks/[id]/files/route";
import type { ReconnectResponse } from "@/app/api/sandbox/reconnect/route";
import { useTaskDiff } from "@/hooks/use-task-diff";
import { useTaskFiles } from "@/hooks/use-task-files";

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
        setSandboxInfoState({
          createdAt: Date.now(),
          timeout: 300_000,
        });
        setReconnectionStatus("connected");
      } else if (data.status === "no_sandbox") {
        setTask((prev) => ({ ...prev, sandboxState: null }));
        setReconnectionStatus("no_sandbox");
      } else {
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
  } = useTaskDiff(task.id, sandboxConnected, {
    initialData: initialTask.cachedDiff as DiffResponse | null,
    initialCachedAt: initialTask.cachedDiffUpdatedAt ?? null,
  });

  const {
    files,
    isLoading: filesLoading,
    error: filesError,
    refresh: refreshFilesSWR,
  } = useTaskFiles(task.id, sandboxConnected);

  const refreshDiff = useCallback(async () => {
    await refreshDiffSWR();
  }, [refreshDiffSWR]);

  const refreshFiles = useCallback(async () => {
    await refreshFilesSWR();
  }, [refreshFilesSWR]);

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
