"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { TaskInput } from "@/components/task-input";
import { TaskList } from "@/components/task-list";
import { useTasks } from "@/hooks/use-tasks";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSession } from "@/hooks/use-session";

function HomePage() {
  const router = useRouter();
  const { tasks, loading, createTask } = useTasks();
  const { session } = useSession();
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateTask = async (input: {
    prompt: string;
    repoOwner?: string;
    repoName?: string;
    branch?: string;
    cloneUrl?: string;
    isNewBranch: boolean;
    modelId: string;
  }) => {
    setIsCreating(true);
    try {
      const task = await createTask({
        title: input.prompt,
        repoOwner: input.repoOwner,
        repoName: input.repoName,
        branch: input.branch,
        cloneUrl: input.cloneUrl,
        isNewBranch: input.isNewBranch,
        modelId: input.modelId,
      });
      // Navigate to the task detail page
      router.push(`/tasks/${task.id}`);
    } catch (error) {
      console.error("Failed to create task:", error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleTaskClick = (taskId: string) => {
    router.push(`/tasks/${taskId}`);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-4 w-4"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
          </div>
          <span className="text-lg font-semibold">Open Harness</span>
        </div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Settings
          </button>
          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Docs
          </button>
          {session?.user && (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-600 text-xs font-medium text-white">
              {session.user.username.slice(0, 2).toUpperCase()}
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex flex-1 flex-col items-center px-6 pt-16">
        <h1 className="mb-8 text-3xl font-light text-foreground">
          What should we code next?
        </h1>

        <TaskInput onSubmit={handleCreateTask} isLoading={isCreating} />

        {/* Tabs */}
        <div className="mt-8 w-full max-w-2xl">
          <Tabs defaultValue="tasks">
            <TabsList className="h-auto w-auto justify-start gap-8 bg-transparent p-0">
              <TabsTrigger
                value="tasks"
                className="relative h-auto rounded-none border-0 bg-transparent px-0 pb-3 pt-0 text-sm font-normal text-muted-foreground shadow-none transition-colors hover:bg-transparent hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:font-normal data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent data-[state=active]:after:absolute data-[state=active]:after:-bottom-px data-[state=active]:after:left-0 data-[state=active]:after:right-0 data-[state=active]:after:h-px data-[state=active]:after:bg-foreground"
              >
                Tasks
              </TabsTrigger>
              <TabsTrigger
                value="archive"
                className="relative h-auto rounded-none border-0 bg-transparent px-0 pb-3 pt-0 text-sm font-normal text-muted-foreground shadow-none transition-colors hover:bg-transparent hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:font-normal data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent data-[state=active]:after:absolute data-[state=active]:after:-bottom-px data-[state=active]:after:left-0 data-[state=active]:after:right-0 data-[state=active]:after:h-px data-[state=active]:after:bg-foreground"
              >
                Archive
              </TabsTrigger>
            </TabsList>
            <TabsContent value="tasks" className="mt-6">
              {loading ? (
                <div className="py-8 text-center text-muted-foreground">
                  Loading tasks...
                </div>
              ) : (
                <TaskList
                  tasks={tasks.filter((t) => t.status !== "archived")}
                  onTaskClick={handleTaskClick}
                />
              )}
            </TabsContent>
            <TabsContent value="archive" className="mt-6">
              {loading ? (
                <div className="py-8 text-center text-muted-foreground">
                  Loading tasks...
                </div>
              ) : (
                <TaskList
                  tasks={tasks.filter((t) => t.status === "archived")}
                  onTaskClick={handleTaskClick}
                  emptyMessage="No archived tasks"
                />
              )}
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <AuthGuard>
      <HomePage />
    </AuthGuard>
  );
}
