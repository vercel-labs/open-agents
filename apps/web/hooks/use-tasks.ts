"use client";

import { useState, useEffect, useCallback } from "react";
import type { Task } from "@/lib/db/schema";

interface CreateTaskInput {
  title: string;
  repoOwner?: string;
  repoName?: string;
  branch?: string;
  cloneUrl?: string;
  sandboxId?: string;
  isNewBranch?: boolean;
}

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks");
      if (!res.ok) {
        throw new Error("Failed to fetch tasks");
      }
      const data = (await res.json()) as { tasks: Task[] };
      setTasks(data.tasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch tasks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const createTask = useCallback(async (input: CreateTaskInput) => {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      throw new Error(data.error ?? "Failed to create task");
    }

    const data = (await res.json()) as { task: Task };
    setTasks((prev) => [data.task, ...prev]);
    return data.task;
  }, []);

  const archiveTask = useCallback(async (taskId: string) => {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });

    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      throw new Error(data.error ?? "Failed to archive task");
    }

    const data = (await res.json()) as { task: Task };
    setTasks((prev) => prev.map((t) => (t.id === taskId ? data.task : t)));
    return data.task;
  }, []);

  return {
    tasks,
    loading,
    error,
    createTask,
    archiveTask,
    refreshTasks: fetchTasks,
  };
}
