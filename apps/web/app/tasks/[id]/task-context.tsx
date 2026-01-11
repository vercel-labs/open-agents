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

export type SandboxInfo = {
  sandboxId: string;
  createdAt: number;
  timeout: number;
  currentBranch?: string;
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
  }, []);

  const clearSandboxInfo = useCallback(() => {
    sandboxIdRef.current = null;
    setSandboxInfoState(null);
  }, []);

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
