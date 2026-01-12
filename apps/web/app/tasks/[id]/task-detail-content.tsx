"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isToolUIPart } from "ai";
import type { ComponentProps, ReactNode } from "react";
import { Children, cloneElement, isValidElement } from "react";
import type { BundledTheme } from "shiki";
import { Streamdown } from "streamdown";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Square,
  X,
  Archive,
  Share2,
  GitPullRequest,
  FolderGit2,
  MoreVertical,
  GitCompare,
  Save,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ToolCall } from "@/components/tool-call";
import { TaskGroupView } from "@/components/task-group-view";
import { CreatePRDialog } from "@/components/create-pr-dialog";
import { CreateRepoDialog } from "@/components/create-repo-dialog";
import { useScrollToBottom } from "@/hooks/use-scroll-to-bottom";
import type { WebAgentUIToolPart, WebAgentUIMessagePart } from "@/app/types";
import type { TaskToolUIPart } from "@open-harness/agent";

import { useTaskChatContext, type SandboxInfo } from "./task-context";
import { DiffViewer } from "./diff-viewer";

const customComponents = {
  pre: ({ children, ...props }: ComponentProps<"pre">) => {
    const processChildren = (child: ReactNode): ReactNode => {
      if (isValidElement<{ children?: ReactNode }>(child)) {
        const codeContent = child.props.children;
        if (typeof codeContent === "string") {
          return cloneElement(child, {
            children: codeContent.trimEnd(),
          });
        }
      }
      return child;
    };
    return <pre {...props}>{Children.map(children, processChildren)}</pre>;
  },
};

const shikiThemes = ["github-dark", "github-dark"] as [
  BundledTheme,
  BundledTheme,
];

async function createSandbox(
  cloneUrl: string | undefined,
  branch: string | undefined,
  isNewBranch: boolean,
  taskId: string,
  existingSandboxId: string | undefined,
): Promise<SandboxInfo> {
  const response = await fetch("/api/sandbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repoUrl: cloneUrl,
      branch: cloneUrl ? (branch ?? "main") : undefined,
      isNewBranch: cloneUrl ? isNewBranch : false,
      taskId,
      sandboxId: existingSandboxId,
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Failed to create sandbox: ${response.status}${text ? ` - ${text}` : ""}`,
    );
  }
  return (await response.json()) as SandboxInfo;
}

function isSandboxValid(sandboxInfo: SandboxInfo | null): boolean {
  if (!sandboxInfo) return false;
  const expiresAt = sandboxInfo.createdAt + sandboxInfo.timeout;
  return Date.now() < expiresAt - 10_000;
}

function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function SandboxStatus({
  sandboxInfo,
  isCreating,
  isSavingSnapshot,
  isRestoring,
  hasSnapshot,
  onKill,
  onSaveAndKill,
  onSaveSnapshot,
  onRestore,
}: {
  sandboxInfo: SandboxInfo | null;
  isCreating: boolean;
  isSavingSnapshot: boolean;
  isRestoring: boolean;
  hasSnapshot: boolean;
  onKill: () => void;
  onSaveAndKill: () => void;
  onSaveSnapshot: () => void;
  onRestore: () => void;
}) {
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [showStopConfirm, setShowStopConfirm] = useState(false);

  useEffect(() => {
    if (!sandboxInfo) {
      setTimeRemaining(null);
      return;
    }

    const updateTime = () => {
      const expiresAt = sandboxInfo.createdAt + sandboxInfo.timeout;
      const remaining = expiresAt - Date.now();
      setTimeRemaining(remaining > 0 ? remaining : 0);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [sandboxInfo]);

  if (isCreating || isRestoring) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
        <span>
          {isRestoring ? "Restoring snapshot..." : "Creating sandbox..."}
        </span>
      </div>
    );
  }

  // No sandbox and has snapshot - show restore option
  if (!sandboxInfo && hasSnapshot) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="h-2 w-2 rounded-full bg-amber-500" />
        <span>Sandbox stopped</span>
        <button
          type="button"
          onClick={onRestore}
          className="flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-primary hover:bg-primary/20"
        >
          <span>Restore snapshot</span>
        </button>
      </div>
    );
  }

  if (!sandboxInfo || timeRemaining === null) {
    return null;
  }

  if (timeRemaining <= 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="h-2 w-2 rounded-full bg-red-500" />
        <span>Sandbox expired</span>
        {hasSnapshot && (
          <button
            type="button"
            onClick={onRestore}
            className="flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-primary hover:bg-primary/20"
          >
            <span>Restore snapshot</span>
          </button>
        )}
      </div>
    );
  }

  if (showStopConfirm) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Save before stopping?</span>
        <button
          type="button"
          onClick={() => {
            setShowStopConfirm(false);
            onSaveAndKill();
          }}
          disabled={isSavingSnapshot}
          className="flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-primary hover:bg-primary/20 disabled:opacity-50"
        >
          {isSavingSnapshot ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Save className="h-3 w-3" />
          )}
          <span>Save</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setShowStopConfirm(false);
            onKill();
          }}
          className="rounded px-1.5 py-0.5 hover:bg-muted-foreground/20"
        >
          <span>Discard</span>
        </button>
        <button
          type="button"
          onClick={() => setShowStopConfirm(false)}
          className="rounded p-0.5 hover:bg-muted-foreground/20"
          title="Cancel"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="h-2 w-2 rounded-full bg-green-500" />
      <span>{formatTimeRemaining(timeRemaining)}</span>
      <button
        type="button"
        onClick={onSaveSnapshot}
        disabled={isSavingSnapshot}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted-foreground/20 disabled:opacity-50"
        title="Save snapshot"
      >
        {isSavingSnapshot ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Save className="h-3 w-3" />
        )}
        <span>Save</span>
      </button>
      <button
        type="button"
        onClick={() => setShowStopConfirm(true)}
        className="rounded p-0.5 hover:bg-muted-foreground/20"
        title="Stop sandbox"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function TaskDetailContent() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [isCreatingSandbox, setIsCreatingSandbox] = useState(false);
  const [isSavingSnapshot, setIsSavingSnapshot] = useState(false);
  const [isRestoringSnapshot, setIsRestoringSnapshot] = useState(false);
  const [prDialogOpen, setPrDialogOpen] = useState(false);
  const [repoDialogOpen, setRepoDialogOpen] = useState(false);
  const [showDiffPanel, setShowDiffPanel] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { containerRef, isAtBottom, scrollToBottom } =
    useScrollToBottom<HTMLDivElement>();
  const {
    task,
    chat,
    sandboxInfo,
    setSandboxInfo,
    clearSandboxInfo,
    archiveTask,
    hadInitialMessages,
    diffRefreshKey,
    triggerDiffRefresh,
    updateTaskSnapshot,
  } = useTaskChatContext();
  const {
    messages,
    error,
    sendMessage,
    status,
    addToolApprovalResponse,
    stop,
  } = chat;

  const handleKillSandbox = async () => {
    if (!sandboxInfo) return;
    try {
      await fetch("/api/sandbox", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId: sandboxInfo.sandboxId,
          taskId: task.id,
        }),
      });
    } finally {
      clearSandboxInfo();
    }
  };

  const saveSnapshot = async (
    sandboxId: string,
  ): Promise<{
    success: boolean;
    downloadUrl?: string;
    createdAt?: number;
  }> => {
    try {
      const response = await fetch("/api/sandbox/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          taskId: task.id,
        }),
      });

      if (!response.ok) {
        const error = (await response.json()) as { error?: string };
        console.error("Failed to save snapshot:", error.error);
        return { success: false };
      }
      const data = (await response.json()) as {
        downloadUrl: string;
        createdAt: number;
      };
      return {
        success: true,
        downloadUrl: data.downloadUrl,
        createdAt: data.createdAt,
      };
    } catch (err) {
      console.error("Failed to save snapshot:", err);
      return { success: false };
    }
  };

  const handleSaveSnapshot = async () => {
    if (!sandboxInfo) return;
    setIsSavingSnapshot(true);
    try {
      const result = await saveSnapshot(sandboxInfo.sandboxId);
      if (result.success && result.downloadUrl && result.createdAt) {
        updateTaskSnapshot(result.downloadUrl, new Date(result.createdAt));
      }
    } finally {
      setIsSavingSnapshot(false);
    }
  };

  const handleSaveAndKill = async () => {
    if (!sandboxInfo) return;
    setIsSavingSnapshot(true);
    try {
      const result = await saveSnapshot(sandboxInfo.sandboxId);
      if (result.success && result.downloadUrl && result.createdAt) {
        updateTaskSnapshot(result.downloadUrl, new Date(result.createdAt));
      }
    } finally {
      setIsSavingSnapshot(false);
    }
    // Kill sandbox after saving (regardless of save success)
    await handleKillSandbox();
  };

  const [restoreError, setRestoreError] = useState<string | null>(null);

  const handleRestoreSnapshot = async () => {
    if (!task.snapshotUrl) return;

    setIsRestoringSnapshot(true);
    setRestoreError(null);

    let newSandbox: SandboxInfo | null = null;
    try {
      // First create a new sandbox
      // Don't pass task.sandboxId - we're creating a fresh sandbox for restore,
      // and the React state may be stale (not synced with DB after discard)
      //
      // For isNewBranch tasks: if no PR exists, the branch was never pushed to origin.
      // We need to use the newBranch pattern (clone default, create branch locally).
      // If a PR exists, the branch was pushed and we can clone it directly.
      const branchExistsOnOrigin = task.prNumber != null;
      const useNewBranch = task.isNewBranch && !branchExistsOnOrigin;

      newSandbox = await createSandbox(
        task.cloneUrl ?? undefined,
        task.branch ?? undefined,
        useNewBranch,
        task.id,
        undefined,
      );
      setSandboxInfo(newSandbox);

      // Then restore the snapshot
      const response = await fetch("/api/sandbox/snapshot", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId: newSandbox.sandboxId,
          taskId: task.id,
        }),
      });

      if (!response.ok) {
        const error = (await response.json()) as { error?: string };
        const errorMsg = error.error ?? "Unknown error";
        console.error("Failed to restore snapshot:", errorMsg);
        setRestoreError(
          `Snapshot restore failed: ${errorMsg}. Sandbox is running but may be empty.`,
        );
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("Failed to restore snapshot:", err);
      // If sandbox was created but restore failed, show warning
      if (newSandbox) {
        setRestoreError(
          `Snapshot restore failed: ${errorMsg}. Sandbox is running but may be empty.`,
        );
      } else {
        setRestoreError(`Failed to create sandbox: ${errorMsg}`);
      }
    } finally {
      setIsRestoringSnapshot(false);
    }
  };

  useEffect(() => {
    if (isAtBottom) {
      scrollToBottom();
    }
  }, [messages, isAtBottom, scrollToBottom]);

  useEffect(() => {
    if (status !== "streaming") {
      inputRef.current?.focus();
    }
  }, [status]);

  // Auto-send initial message when task loads and no messages exist
  // Use hadInitialMessages to prevent race condition on remount
  const hasSentInitialMessage = useRef(hadInitialMessages);
  useEffect(() => {
    if (messages.length === 0 && !hasSentInitialMessage.current) {
      hasSentInitialMessage.current = true;

      // Create sandbox and send first message
      const initTask = async () => {
        // Always create a sandbox - either with repo or empty
        setIsCreatingSandbox(true);
        try {
          // For isNewBranch tasks: use newBranch pattern if branch doesn't exist on origin.
          // Branch only exists on origin if a PR was created (which pushes the branch).
          const branchExistsOnOrigin = task.prNumber != null;
          const shouldCreateNewBranch =
            task.isNewBranch && !branchExistsOnOrigin;
          const newSandbox = await createSandbox(
            task.cloneUrl ?? undefined,
            task.branch ?? undefined,
            shouldCreateNewBranch,
            task.id,
            task.sandboxId ?? undefined,
          );
          setSandboxInfo(newSandbox);
        } catch (err) {
          console.error("Failed to create sandbox:", err);
          return;
        } finally {
          setIsCreatingSandbox(false);
        }

        // Send initial message for all tasks (with or without repo)
        sendMessage({ text: task.title });
      };

      initTask();
    }
  }, [
    messages.length,
    sendMessage,
    setSandboxInfo,
    task.id,
    task.cloneUrl,
    task.branch,
    task.isNewBranch,
    task.sandboxId,
    task.title,
  ]);

  // Track tool completions to trigger diff refresh
  const prevToolStatesRef = useRef<Map<string, string>>(new Map());
  // Track if we've auto-opened the diff panel (don't re-open if user closed it)
  const hasAutoOpenedDiffRef = useRef(false);

  // Extract current tool states from messages
  const currentToolStates = useMemo(() => {
    const states = new Map<string, string>();
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      for (const part of message.parts) {
        if (isToolUIPart(part)) {
          states.set(part.toolCallId, part.state);
        }
      }
    }
    return states;
  }, [messages]);

  useEffect(() => {
    let hasFileChange = false;
    const fileModifyingTools = ["tool-write", "tool-edit"];

    for (const message of messages) {
      if (message.role !== "assistant") continue;

      for (const part of message.parts) {
        if (!isToolUIPart(part)) continue;

        const toolId = part.toolCallId;
        const toolState = part.state;
        const prevState = prevToolStatesRef.current.get(toolId);
        const isFileModifyingTool = fileModifyingTools.includes(part.type);
        const justCompleted =
          toolState === "output-available" && prevState !== "output-available";

        if (isFileModifyingTool && justCompleted) {
          hasFileChange = true;
        }
      }
    }

    prevToolStatesRef.current = currentToolStates;

    if (hasFileChange) {
      // Auto-open diff panel on first file change
      if (!showDiffPanel && !hasAutoOpenedDiffRef.current && sandboxInfo) {
        hasAutoOpenedDiffRef.current = true;
        setShowDiffPanel(true);
      }
      // Always invalidate cache when files change
      triggerDiffRefresh();
    }
  }, [
    currentToolStates,
    messages,
    showDiffPanel,
    sandboxInfo,
    triggerDiffRefresh,
  ]);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-destructive">{error.message}</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Main chat area */}
      <div className="flex flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => router.push("/")}
              className="rounded-lg p-2 hover:bg-muted"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="font-medium">{task.title}</h1>
              <p className="text-sm text-muted-foreground">
                {formatDate(new Date(task.createdAt))}
                {task.repoName && (
                  <>
                    {" "}
                    <span className="text-muted-foreground/50">-</span>{" "}
                    {task.repoOwner}/{task.repoName}
                  </>
                )}
                {task.branch && (
                  <>
                    {" "}
                    <span className="text-muted-foreground/50">-</span>{" "}
                    {task.branch}
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await archiveTask();
                router.push("/");
              }}
            >
              <Archive className="mr-2 h-4 w-4" />
              Archive
            </Button>
            <Button variant="ghost" size="sm">
              <Share2 className="mr-2 h-4 w-4" />
              Share
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDiffPanel(!showDiffPanel)}
              disabled={!sandboxInfo}
            >
              <GitCompare className="mr-2 h-4 w-4" />
              Diff
            </Button>
            {task?.cloneUrl ? (
              // Task has a repo - show PR buttons
              task?.prNumber ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const prUrl = `https://github.com/${task.repoOwner}/${task.repoName}/pull/${task.prNumber}`;
                    window.open(prUrl, "_blank");
                  }}
                >
                  <GitPullRequest className="mr-2 h-4 w-4" />
                  View PR #{task.prNumber}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPrDialogOpen(true)}
                  disabled={!task?.branch}
                >
                  <GitPullRequest className="mr-2 h-4 w-4" />
                  Create PR
                </Button>
              )
            ) : (
              // Task has no repo - show Create Repo button
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRepoDialogOpen(true)}
              >
                <FolderGit2 className="mr-2 h-4 w-4" />
                Create Repo
              </Button>
            )}
            <Button variant="ghost" size="icon">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {/* Messages */}
        <div className="relative flex-1 overflow-hidden">
          <div ref={containerRef} className="h-full overflow-y-auto">
            <div className="mx-auto max-w-3xl px-4 py-8">
              <div className="space-y-6">
                {messages.map((m, messageIndex) => {
                  const isLastMessage = messageIndex === messages.length - 1;
                  const isMessageStreaming =
                    status === "streaming" && isLastMessage;

                  type RenderGroup =
                    | {
                        type: "part";
                        part: WebAgentUIMessagePart;
                        index: number;
                      }
                    | {
                        type: "task-group";
                        tasks: TaskToolUIPart[];
                        startIndex: number;
                      };

                  const renderGroups: RenderGroup[] = [];
                  let currentTaskGroup: TaskToolUIPart[] = [];
                  let taskGroupStartIndex = 0;

                  m.parts.forEach((part, index) => {
                    if (isToolUIPart(part) && part.type === "tool-task") {
                      if (currentTaskGroup.length === 0) {
                        taskGroupStartIndex = index;
                      }
                      currentTaskGroup.push(part as TaskToolUIPart);
                    } else {
                      if (currentTaskGroup.length > 0) {
                        renderGroups.push({
                          type: "task-group",
                          tasks: currentTaskGroup,
                          startIndex: taskGroupStartIndex,
                        });
                        currentTaskGroup = [];
                      }
                      renderGroups.push({ type: "part", part, index });
                    }
                  });

                  if (currentTaskGroup.length > 0) {
                    renderGroups.push({
                      type: "task-group",
                      tasks: currentTaskGroup,
                      startIndex: taskGroupStartIndex,
                    });
                  }

                  return renderGroups.map((group) => {
                    if (group.type === "task-group") {
                      return (
                        <div
                          key={`${m.id}-task-group-${group.startIndex}`}
                          className="max-w-full"
                        >
                          <TaskGroupView
                            taskParts={group.tasks}
                            activeApprovalId={
                              group.tasks.find(
                                (t) => t.state === "approval-requested",
                              )?.approval?.id ?? null
                            }
                            isStreaming={isMessageStreaming}
                            onApprove={(id) =>
                              addToolApprovalResponse({ id, approved: true })
                            }
                            onDeny={(id, reason) =>
                              addToolApprovalResponse({
                                id,
                                approved: false,
                                reason,
                              })
                            }
                          />
                        </div>
                      );
                    }

                    const p = group.part;
                    const i = group.index;

                    if (p.type === "text") {
                      return (
                        <div
                          key={`${m.id}-${i}`}
                          className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                        >
                          {m.role === "user" ? (
                            <div className="max-w-[80%] rounded-3xl bg-secondary px-4 py-2">
                              <p className="whitespace-pre-wrap">{p.text}</p>
                            </div>
                          ) : (
                            <div className="max-w-[80%]">
                              <Streamdown
                                isAnimating={isMessageStreaming}
                                shikiTheme={shikiThemes}
                                components={customComponents}
                              >
                                {p.text}
                              </Streamdown>
                            </div>
                          )}
                        </div>
                      );
                    }

                    if (isToolUIPart(p)) {
                      return (
                        <div key={`${m.id}-${i}`} className="max-w-full">
                          <ToolCall
                            part={p as WebAgentUIToolPart}
                            isStreaming={isMessageStreaming}
                            onApprove={(id) =>
                              addToolApprovalResponse({ id, approved: true })
                            }
                            onDeny={(id, reason) =>
                              addToolApprovalResponse({
                                id,
                                approved: false,
                                reason,
                              })
                            }
                          />
                        </div>
                      );
                    }

                    return null;
                  });
                })}
              </div>
            </div>
          </div>
          {!isAtBottom && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-secondary text-secondary-foreground hover:bg-accent"
              onClick={scrollToBottom}
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Input */}
        <div className="p-4 pb-8">
          <div className="mx-auto max-w-3xl space-y-2">
            {restoreError && (
              <div className="flex items-center justify-between rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <span>{restoreError}</span>
                <button
                  type="button"
                  onClick={() => setRestoreError(null)}
                  className="ml-2 rounded p-0.5 hover:bg-destructive/20"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            <div className="flex justify-end px-2">
              <SandboxStatus
                sandboxInfo={sandboxInfo}
                isCreating={isCreatingSandbox}
                isSavingSnapshot={isSavingSnapshot}
                isRestoring={isRestoringSnapshot}
                hasSnapshot={!!task.snapshotUrl}
                onKill={handleKillSandbox}
                onSaveAndKill={handleSaveAndKill}
                onSaveSnapshot={handleSaveSnapshot}
                onRestore={handleRestoreSnapshot}
              />
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!input.trim()) return;

                const messageText = input;
                setInput("");

                // Recreate sandbox if expired
                if (!isSandboxValid(sandboxInfo)) {
                  setIsCreatingSandbox(true);
                  try {
                    // For isNewBranch tasks: use newBranch pattern if branch doesn't exist on origin.
                    // Branch only exists on origin if a PR was created (which pushes the branch).
                    const branchExistsOnOrigin = task.prNumber != null;
                    const shouldCreateNewBranch =
                      task.isNewBranch && !branchExistsOnOrigin;
                    const newSandbox = await createSandbox(
                      task.cloneUrl ?? undefined,
                      task.branch ?? undefined,
                      shouldCreateNewBranch,
                      task.id,
                      task.sandboxId ?? undefined,
                    );
                    setSandboxInfo(newSandbox);
                  } catch {
                    setInput(messageText);
                    return;
                  } finally {
                    setIsCreatingSandbox(false);
                  }
                }

                sendMessage({ text: messageText });
              }}
              className="flex items-center gap-2 rounded-full bg-muted px-4 py-2"
            >
              <input
                ref={inputRef}
                value={input}
                placeholder="Request changes or ask a ..."
                onChange={(e) => setInput(e.currentTarget.value)}
                disabled={status === "streaming"}
                className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              {status === "streaming" ? (
                <Button
                  type="button"
                  size="icon"
                  onClick={stop}
                  className="h-8 w-8 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  <Square className="h-3 w-3 fill-current" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon"
                  disabled={!input.trim()}
                  className="h-8 w-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30"
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
              )}
            </form>
          </div>
        </div>
      </div>

      {/* Create PR Dialog */}
      {task && (
        <CreatePRDialog
          open={prDialogOpen}
          onOpenChange={setPrDialogOpen}
          task={task}
          sandboxId={sandboxInfo?.sandboxId ?? null}
        />
      )}

      {/* Create Repo Dialog */}
      {task && (
        <CreateRepoDialog
          open={repoDialogOpen}
          onOpenChange={setRepoDialogOpen}
          task={task}
          sandboxId={sandboxInfo?.sandboxId ?? null}
        />
      )}

      {/* Diff Viewer Panel */}
      {showDiffPanel && sandboxInfo && (
        <DiffViewer
          sandboxId={sandboxInfo.sandboxId}
          refreshKey={diffRefreshKey}
          onClose={() => setShowDiffPanel(false)}
        />
      )}
    </div>
  );
}
