"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import {
  lastAssistantMessageIsCompleteWithApprovalResponses,
  DefaultChatTransport,
} from "ai";
import { useChat, type UseChatHelpers } from "@ai-sdk/react";
import type { WebAgentUIMessage } from "@/app/types";
import type { Task } from "@/lib/db/schema";

export type SandboxInfo = {
  sandboxId: string;
  createdAt: number;
  timeout: number;
  currentBranch?: string;
};

type TaskChatContextValue = {
  task: Task | null;
  chat: UseChatHelpers<WebAgentUIMessage>;
  sandboxInfo: SandboxInfo | null;
  setSandboxInfo: (info: SandboxInfo) => void;
  clearSandboxInfo: () => void;
  isLoading: boolean;
};

const TaskChatContext = createContext<TaskChatContextValue | undefined>(
  undefined,
);

type TaskChatProviderProps = {
  taskId: string;
  children: ReactNode;
};

export function TaskChatProvider({ taskId, children }: TaskChatProviderProps) {
  const [task, setTask] = useState<Task | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const sandboxIdRef = useRef<string | null>(null);

  // Fetch task on mount
  useEffect(() => {
    const fetchTask = async () => {
      try {
        const res = await fetch(`/api/tasks/${taskId}`);
        if (res.ok) {
          const data = (await res.json()) as { task: Task };
          setTask(data.task);
          // Set sandbox ID if task has one
          if (data.task.sandboxId) {
            sandboxIdRef.current = data.task.sandboxId;
          }
        }
      } catch (error) {
        console.error("Failed to fetch task:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchTask();
  }, [taskId]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: () => ({
          sandboxId: sandboxIdRef.current,
          taskId,
        }),
      }),
    [taskId],
  );

  const chat = useChat<WebAgentUIMessage>({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });

  const [sandboxInfo, setSandboxInfoState] = useState<SandboxInfo | null>(null);

  const setSandboxInfo = useCallback((info: SandboxInfo) => {
    sandboxIdRef.current = info.sandboxId;
    setSandboxInfoState(info);
  }, []);

  const clearSandboxInfo = useCallback(() => {
    sandboxIdRef.current = null;
    setSandboxInfoState(null);
  }, []);

  return (
    <TaskChatContext.Provider
      value={{
        task,
        chat,
        sandboxInfo,
        setSandboxInfo,
        clearSandboxInfo,
        isLoading,
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
