"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import type { Task } from "@/lib/db/schema";

interface CreateTaskInput {
  title: string;
  repoOwner?: string;
  repoName?: string;
  branch?: string;
  cloneUrl?: string;
  sandboxId?: string;
  isNewBranch?: boolean;
  modelId?: string;
}

interface TasksResponse {
  tasks: Task[];
}

export function useTasks() {
  const { data, error, isLoading, mutate } = useSWR<TasksResponse>(
    "/api/tasks",
    fetcher,
  );

  const tasks = data?.tasks ?? [];

  const createTask = async (input: CreateTaskInput) => {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      const errorData = (await res.json()) as { error?: string };
      throw new Error(errorData.error ?? "Failed to create task");
    }

    const responseData = (await res.json()) as { task: Task };
    // Optimistically update the cache using functional form to avoid stale closure
    mutate(
      (current) => ({
        tasks: [responseData.task, ...(current?.tasks ?? [])],
      }),
      { revalidate: false },
    );
    return responseData.task;
  };

  const archiveTask = async (taskId: string) => {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });

    if (!res.ok) {
      const errorData = (await res.json()) as { error?: string };
      throw new Error(errorData.error ?? "Failed to archive task");
    }

    const responseData = (await res.json()) as { task: Task };
    // Optimistically update the cache using functional form to avoid stale closure
    mutate(
      (current) => ({
        tasks: (current?.tasks ?? []).map((t) =>
          t.id === taskId ? responseData.task : t,
        ),
      }),
      { revalidate: false },
    );
    return responseData.task;
  };

  return {
    tasks,
    loading: isLoading,
    error: error?.message ?? null,
    createTask,
    archiveTask,
    refreshTasks: mutate,
  };
}
