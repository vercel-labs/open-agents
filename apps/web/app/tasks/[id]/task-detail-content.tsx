"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  GitPullRequest,
  FolderGit2,
  GitCompare,
  Paperclip,
  Loader2,
  Mic,
  Pencil,
  Check,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ToolCall } from "@/components/tool-call";
import { TaskGroupView } from "@/components/task-group-view";
import { CreatePRDialog } from "@/components/create-pr-dialog";
import { CreateRepoDialog } from "@/components/create-repo-dialog";
import { ImageAttachmentsPreview } from "@/components/image-attachments-preview";
import { useScrollToBottom } from "@/hooks/use-scroll-to-bottom";
import { useImageAttachments } from "@/hooks/use-image-attachments";
import { useAudioRecording } from "@/hooks/use-audio-recording";
import { ACCEPT_IMAGE_TYPES, isValidImageType } from "@/lib/image-utils";
import type { WebAgentUIToolPart, WebAgentUIMessagePart } from "@/app/types";
import type { TaskToolUIPart } from "@open-harness/agent";

import { useTaskChatContext, type SandboxInfo } from "./task-context";
import { DiffViewer } from "./diff-viewer";
import { useFileSuggestions } from "@/hooks/use-file-suggestions";
import { FileSuggestionsDropdown } from "@/components/file-suggestions-dropdown";

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

function useSandboxTimeRemaining(sandboxInfo: SandboxInfo | null) {
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);

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

  return timeRemaining;
}

const WARNING_THRESHOLD_MS = 60_000; // Show warning when < 1 minute remaining

function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return tokens.toString();
}

function CircularProgress({
  percentage,
  size = 16,
  strokeWidth = 2,
}: {
  percentage: number;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <svg width={size} height={size} className="-rotate-90">
      {/* Background circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-muted-foreground/20"
      />
      {/* Progress circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
        className="text-muted-foreground"
      />
    </svg>
  );
}

function ContextUsageIndicator({
  inputTokens,
  outputTokens,
  contextLimit,
}: {
  inputTokens: number;
  outputTokens: number;
  contextLimit: number;
}) {
  if (inputTokens === 0) {
    return null;
  }

  const percentage =
    contextLimit > 0 ? Math.round((inputTokens / contextLimit) * 100) : 0;

  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <div className="flex cursor-default items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground">
          <span>{percentage}%</span>
          <CircularProgress percentage={percentage} size={14} strokeWidth={2} />
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="min-w-[160px] p-0">
        <div className="p-3">
          {/* Header with percentage and token count */}
          <div className="flex items-center justify-between gap-6">
            <span className="text-sm font-medium">{percentage}%</span>
            <span className="text-xs opacity-60">
              {formatTokens(inputTokens)} / {formatTokens(contextLimit)}
            </span>
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-current opacity-10" />

        {/* Breakdown */}
        <div className="space-y-1 p-3 text-xs">
          <div className="flex justify-between gap-6">
            <span className="opacity-60">Input</span>
            <span>{formatTokens(inputTokens)}</span>
          </div>
          <div className="flex justify-between gap-6">
            <span className="opacity-60">Output</span>
            <span>{formatTokens(outputTokens)}</span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function SandboxHeaderBadge({
  sandboxInfo,
  isCreating,
  isSavingSnapshot,
  isRestoring,
  isExtending,
  timeRemaining,
  onExtend,
  onSaveAndKill,
}: {
  sandboxInfo: SandboxInfo | null;
  isCreating: boolean;
  isSavingSnapshot: boolean;
  isRestoring: boolean;
  isExtending: boolean;
  timeRemaining: number | null;
  onExtend: () => void;
  onSaveAndKill: () => void;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const hasAutoSavedRef = useRef(false);

  // Reset auto-save flag when sandbox changes
  useEffect(() => {
    hasAutoSavedRef.current = false;
  }, [sandboxInfo?.sandboxId]);

  // Reset stopping state when sandbox becomes inactive
  useEffect(() => {
    if (!sandboxInfo) {
      setIsStopping(false);
    }
  }, [sandboxInfo]);

  // Auto-save when timeout reached
  useEffect(() => {
    if (
      timeRemaining !== null &&
      timeRemaining <= 0 &&
      !hasAutoSavedRef.current &&
      !isSavingSnapshot
    ) {
      hasAutoSavedRef.current = true;
      setIsStopping(true);
      onSaveAndKill();
    }
  }, [timeRemaining, isSavingSnapshot, onSaveAndKill]);

  const handleStop = () => {
    setIsStopping(true);
    onSaveAndKill();
  };

  // Creating or restoring - show spinner dot
  if (isCreating || isRestoring) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center justify-center">
            <Loader2 className="size-3 animate-spin text-yellow-500" />
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={8}>
          {isRestoring ? "Restoring sandbox..." : "Creating sandbox..."}
        </TooltipContent>
      </Tooltip>
    );
  }

  // Stopping - show optimistic pausing state
  if (isStopping && sandboxInfo) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center justify-center">
            <Loader2 className="size-3 animate-spin text-muted-foreground" />
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={8}>
          Pausing sandbox...
        </TooltipContent>
      </Tooltip>
    );
  }

  // Inactive - show gray dot
  if (!sandboxInfo || timeRemaining === null || timeRemaining <= 0) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center justify-center p-1">
            <span className="size-2.5 rounded-full bg-muted-foreground/40" />
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={8}>
          Sandbox inactive
        </TooltipContent>
      </Tooltip>
    );
  }

  const isWarning = timeRemaining < WARNING_THRESHOLD_MS;
  const secondsRemaining = Math.ceil(timeRemaining / 1000);

  // Warning state - show message with extend and close buttons
  if (isWarning) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-orange-500">
          Pausing in {secondsRemaining}s
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onExtend}
          disabled={isExtending}
          className="h-6 px-2 text-xs"
        >
          {isExtending ? <Loader2 className="size-3 animate-spin" /> : "Extend"}
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleStop}
              disabled={isSavingSnapshot}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <X className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8}>
            Save and pause
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  // Active - show green dot with X on hover
  return (
    <div
      className="flex items-center gap-1"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center p-1">
            <span className="size-2.5 rounded-full bg-green-500" />
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={8}>
          Sandbox active
        </TooltipContent>
      </Tooltip>

      {/* X button on hover */}
      {isHovered && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleStop}
              disabled={isSavingSnapshot}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <X className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8}>
            Save and pause
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

function SandboxInputOverlay({
  sandboxInfo,
  isCreating,
  isRestoring,
  hasSnapshot,
  onRestore,
  onCreateNew,
}: {
  sandboxInfo: SandboxInfo | null;
  isCreating: boolean;
  isRestoring: boolean;
  hasSnapshot: boolean;
  onRestore: () => void;
  onCreateNew: () => void;
}) {
  const isActive = !isCreating && !isRestoring && isSandboxValid(sandboxInfo);

  if (isActive) {
    return null;
  }

  if (isCreating || isRestoring) {
    return (
      <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-background/60 backdrop-blur-[2px]">
        <div className="flex items-center gap-3 rounded-full bg-background/90 px-4 py-2 text-muted-foreground shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">
            {isRestoring ? "Restoring snapshot..." : "Creating sandbox..."}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-background/60 backdrop-blur-[2px]">
      {hasSnapshot ? (
        <Button onClick={onRestore} size="sm" className="shadow-sm">
          Resume sandbox
        </Button>
      ) : (
        <Button onClick={onCreateNew} size="sm" className="shadow-sm">
          Create sandbox
        </Button>
      )}
    </div>
  );
}

export function TaskDetailContent() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [isCreatingSandbox, setIsCreatingSandbox] = useState(false);
  const [isSavingSnapshot, setIsSavingSnapshot] = useState(false);
  const [isRestoringSnapshot, setIsRestoringSnapshot] = useState(false);
  const [isExtendingSandbox, setIsExtendingSandbox] = useState(false);
  const [prDialogOpen, setPrDialogOpen] = useState(false);
  const [repoDialogOpen, setRepoDialogOpen] = useState(false);
  const [showDiffPanel, setShowDiffPanel] = useState(false);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const {
    state: recordingState,
    error: recordingError,
    clearError: clearRecordingError,
    toggleRecording,
  } = useAudioRecording();

  const handleMicClick = async () => {
    clearRecordingError();
    const transcribedText = await toggleRecording();
    if (transcribedText) {
      setInput((prev) =>
        prev ? `${prev} ${transcribedText}` : transcribedText,
      );
      inputRef.current?.focus();
    }
  };

  // Auto-resize textarea up to 3 lines
  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    const computedStyle = getComputedStyle(textarea);
    const lineHeight = parseFloat(computedStyle.lineHeight) || 24;
    const maxLines = 3;
    const maxHeight = lineHeight * maxLines;

    // Store current height to avoid flicker
    const currentHeight = textarea.offsetHeight;

    // Temporarily set height to 0 to measure scrollHeight accurately
    textarea.style.height = "0";
    const scrollHeight = textarea.scrollHeight;

    // Set new height, capped at max
    const newHeight = Math.min(scrollHeight, maxHeight);

    // Only update if height actually changed to minimize reflows
    if (Math.abs(newHeight - currentHeight) > 1) {
      textarea.style.height = `${newHeight}px`;
    } else {
      textarea.style.height = `${currentHeight}px`;
    }
  }, [input]);

  // Focus title input when editing starts
  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  const {
    images,
    addImage,
    addImages,
    removeImage,
    clearImages,
    getFileParts,
    fileInputRef,
    openFilePicker,
  } = useImageAttachments();
  const { containerRef, isAtBottom, scrollToBottom } =
    useScrollToBottom<HTMLDivElement>();
  const {
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
    fileCache,
    fetchFiles,
    triggerFileRefresh,
    updateTaskSnapshot,
    reconnectionStatus,
    attemptReconnection,
  } = useTaskChatContext();
  const sandboxTimeRemaining = useSandboxTimeRemaining(sandboxInfo);
  const {
    messages,
    error,
    sendMessage,
    status,
    addToolApprovalResponse,
    stop,
  } = chat;

  const handleFileSelect = (
    value: string,
    mentionStart: number,
    cursorPos: number,
  ) => {
    const before = input.slice(0, mentionStart);
    const after = input.slice(cursorPos);
    const newInput = `${before}@${value} ${after}`;
    setInput(newInput);
    // Move cursor to after the inserted value + space
    const newCursorPos = mentionStart + value.length + 2; // @ + value + space
    setCursorPosition(newCursorPos);
    // Focus input and set cursor position after React renders
    setTimeout(() => {
      // Only set cursor if input hasn't changed (user didn't type in between)
      if (inputRef.current && inputRef.current.value === newInput) {
        inputRef.current.focus();
        inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  };

  const {
    showSuggestions,
    suggestions,
    selectedIndex,
    handleKeyDown: handleSuggestionsKeyDown,
    mentionInfo,
  } = useFileSuggestions({
    inputValue: input,
    cursorPosition,
    files: fileCache.data,
    onSelect: handleFileSelect,
  });

  const handleKillSandbox = useCallback(async () => {
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
  }, [sandboxInfo, task.id, clearSandboxInfo]);

  const saveSnapshot = useCallback(
    async (
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
    },
    [task.id],
  );

  const handleSaveAndKill = useCallback(async () => {
    if (!sandboxInfo || isSavingSnapshotRef.current) return;
    isSavingSnapshotRef.current = true;
    setIsSavingSnapshot(true);
    try {
      const result = await saveSnapshot(sandboxInfo.sandboxId);
      if (result.success && result.downloadUrl && result.createdAt) {
        updateTaskSnapshot(result.downloadUrl, new Date(result.createdAt));
      }
    } finally {
      setIsSavingSnapshot(false);
      isSavingSnapshotRef.current = false;
    }
    // Kill sandbox after saving (regardless of save success)
    await handleKillSandbox();
  }, [sandboxInfo, updateTaskSnapshot, handleKillSandbox, saveSnapshot]);

  const handleExtendSandbox = async () => {
    if (!sandboxInfo) return;
    setIsExtendingSandbox(true);
    try {
      const response = await fetch("/api/sandbox/extend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId: sandboxInfo.sandboxId,
          taskId: task.id,
        }),
      });

      if (!response.ok) {
        const error = (await response.json()) as { error?: string };
        console.error("Failed to extend sandbox:", error.error);
        return;
      }

      const data = (await response.json()) as {
        expiresAt: number;
        extendedBy: number;
      };

      // Update sandbox info with new expiration
      // Use a single timestamp to avoid drift between createdAt and timeout calculation
      const now = Date.now();
      setSandboxInfo({
        ...sandboxInfo,
        createdAt: now,
        timeout: data.expiresAt - now,
      });
    } catch (err) {
      console.error("Failed to extend sandbox:", err);
    } finally {
      setIsExtendingSandbox(false);
    }
  };

  const [restoreError, setRestoreError] = useState<string | null>(null);
  const isSavingSnapshotRef = useRef(false);

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

  const handleCreateNewSandbox = useCallback(async () => {
    setIsCreatingSandbox(true);
    try {
      const branchExistsOnOrigin = task.prNumber != null;
      const shouldCreateNewBranch = task.isNewBranch && !branchExistsOnOrigin;
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
    } finally {
      setIsCreatingSandbox(false);
    }
  }, [
    task.prNumber,
    task.isNewBranch,
    task.cloneUrl,
    task.branch,
    task.id,
    task.sandboxId,
    setSandboxInfo,
  ]);

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

  // Attempt to reconnect to existing sandbox on page refresh
  useEffect(() => {
    // Only attempt reconnection if:
    // 1. We have initial messages (returning to an existing conversation)
    // 2. Task has a sandboxId (sandbox was created before)
    // 3. No current sandboxInfo (haven't reconnected yet)
    // 4. Not already creating a sandbox
    // 5. Reconnection status is idle (haven't tried yet)
    if (
      hadInitialMessages &&
      task.sandboxId &&
      !sandboxInfo &&
      !isCreatingSandbox &&
      reconnectionStatus === "idle"
    ) {
      attemptReconnection();
    }
  }, [
    hadInitialMessages,
    task.sandboxId,
    sandboxInfo,
    isCreatingSandbox,
    reconnectionStatus,
    attemptReconnection,
  ]);

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
    task.prNumber,
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
      triggerFileRefresh();
    }
  }, [
    currentToolStates,
    messages,
    showDiffPanel,
    sandboxInfo,
    triggerDiffRefresh,
    triggerFileRefresh,
  ]);

  // Fetch files when sandbox becomes available
  useEffect(() => {
    if (sandboxInfo && !fileCache.data && !fileCache.isLoading) {
      fetchFiles(sandboxInfo.sandboxId);
    }
  }, [sandboxInfo, fileCache.data, fileCache.isLoading, fetchFiles]);

  // Fetch diff proactively (from sandbox or cached) to show stats in header
  useEffect(() => {
    // Fetch on mount (for cached data) or when sandbox/diffRefreshKey changes
    if (!diffCache.isLoading && diffCache.lastFetchedKey !== diffRefreshKey) {
      fetchDiff(sandboxInfo?.sandboxId);
    }
  }, [
    sandboxInfo?.sandboxId,
    diffRefreshKey,
    diffCache.isLoading,
    diffCache.lastFetchedKey,
    fetchDiff,
  ]);

  // Get token usage from the most recent assistant message (current context usage)
  const tokenUsage = useMemo(() => {
    // Find the last assistant message with usage metadata
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message?.role === "assistant" && message.metadata?.usage) {
        return {
          inputTokens: message.metadata.usage.inputTokens ?? 0,
          outputTokens: message.metadata.usage.outputTokens ?? 0,
        };
      }
    }
    return { inputTokens: 0, outputTokens: 0 };
  }, [messages]);

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
            <div className="flex items-center gap-2 text-sm">
              {task.repoName ? (
                <>
                  <span className="font-medium text-foreground">
                    {task.repoName}
                  </span>
                  {(task.branch ?? sandboxInfo?.currentBranch) && (
                    <>
                      <span className="text-muted-foreground/40">/</span>
                      <span className="text-muted-foreground">
                        {task.branch ?? sandboxInfo?.currentBranch}
                      </span>
                    </>
                  )}
                </>
              ) : isEditingTitle ? (
                <div className="flex items-center gap-1">
                  <input
                    ref={titleInputRef}
                    type="text"
                    value={editedTitle}
                    onChange={(e) => setEditedTitle(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (editedTitle.trim()) {
                          try {
                            await updateTaskTitle(editedTitle.trim());
                          } catch (err) {
                            console.error("Failed to update title:", err);
                          }
                        }
                        setIsEditingTitle(false);
                      } else if (e.key === "Escape") {
                        setIsEditingTitle(false);
                      }
                    }}
                    onBlur={async () => {
                      if (editedTitle.trim() && editedTitle !== task.title) {
                        try {
                          await updateTaskTitle(editedTitle.trim());
                        } catch (err) {
                          console.error("Failed to update title:", err);
                        }
                      }
                      setIsEditingTitle(false);
                    }}
                    className="w-40 rounded border border-border bg-transparent px-2 py-0.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (editedTitle.trim()) {
                        try {
                          await updateTaskTitle(editedTitle.trim());
                        } catch (err) {
                          console.error("Failed to update title:", err);
                        }
                      }
                      setIsEditingTitle(false);
                    }}
                    className="rounded p-1 hover:bg-muted"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <span
                    className="max-w-[200px] truncate text-muted-foreground"
                    title={task.title}
                  >
                    {task.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditedTitle(task.title);
                      setIsEditingTitle(true);
                    }}
                    className="rounded p-1 hover:bg-muted"
                  >
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </div>
              )}
            </div>
            <SandboxHeaderBadge
              sandboxInfo={sandboxInfo}
              isCreating={isCreatingSandbox}
              isSavingSnapshot={isSavingSnapshot}
              isRestoring={isRestoringSnapshot}
              isExtending={isExtendingSandbox}
              timeRemaining={sandboxTimeRemaining}
              onExtend={handleExtendSandbox}
              onSaveAndKill={handleSaveAndKill}
            />
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDiffPanel(!showDiffPanel)}
              disabled={!sandboxInfo && !task.cachedDiff}
            >
              <GitCompare className="mr-2 h-4 w-4" />
              Diff
              {diffCache.data &&
                (diffCache.data.summary.totalAdditions > 0 ||
                  diffCache.data.summary.totalDeletions > 0) && (
                  <span className="ml-2 text-xs">
                    <span className="text-green-500">
                      +{diffCache.data.summary.totalAdditions}
                    </span>{" "}
                    <span className="text-red-400">
                      -{diffCache.data.summary.totalDeletions}
                    </span>
                  </span>
                )}
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
                                mode={
                                  isMessageStreaming ? "streaming" : "static"
                                }
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

                    // Render image attachments
                    if (
                      p.type === "file" &&
                      p.mediaType?.startsWith("image/")
                    ) {
                      return (
                        <div key={`${m.id}-${i}`} className="flex justify-end">
                          <div className="max-w-[80%]">
                            {/* eslint-disable-next-line @next/next/no-img-element -- Data URLs not supported by next/image */}
                            <img
                              src={p.url}
                              alt={p.filename ?? "Attached image"}
                              className="max-h-64 rounded-lg"
                            />
                          </div>
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
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_IMAGE_TYPES}
              multiple
              onChange={(e) => {
                const files = e.target.files;
                if (files && files.length > 0) {
                  addImages(files);
                }
                e.target.value = "";
              }}
              className="hidden"
            />
            <div className="relative">
              {showSuggestions && (
                <FileSuggestionsDropdown
                  suggestions={suggestions}
                  selectedIndex={selectedIndex}
                  onSelect={(suggestion) => {
                    if (mentionInfo) {
                      handleFileSelect(
                        suggestion.value,
                        mentionInfo.mentionStart,
                        cursorPosition,
                      );
                    }
                  }}
                  isLoading={fileCache.isLoading}
                />
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const hasContent = input.trim() || images.length > 0;
                  if (!hasContent || !isSandboxValid(sandboxInfo)) return;

                  const messageText = input;
                  const files = getFileParts();
                  setInput("");
                  clearImages();

                  sendMessage({ text: messageText, files });
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  // Only set isDragging to false if we're leaving the form entirely
                  // (not just moving to a child element)
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setIsDragging(false);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const files = e.dataTransfer.files;
                  if (files.length > 0) {
                    addImages(files);
                  }
                }}
                className={`overflow-hidden rounded-2xl bg-muted transition-colors ${isDragging ? "ring-2 ring-blue-500/50" : ""}`}
              >
                {/* Sandbox overlay when inactive */}
                <SandboxInputOverlay
                  sandboxInfo={sandboxInfo}
                  isCreating={isCreatingSandbox}
                  isRestoring={isRestoringSnapshot}
                  hasSnapshot={!!task.snapshotUrl}
                  onRestore={handleRestoreSnapshot}
                  onCreateNew={handleCreateNewSandbox}
                />

                {/* Image attachments preview */}
                <ImageAttachmentsPreview
                  images={images}
                  onRemove={removeImage}
                />

                {/* Textarea area */}
                <div className="px-4 pb-2 pt-3">
                  <textarea
                    ref={inputRef}
                    value={input}
                    placeholder="Request changes or ask a question..."
                    rows={1}
                    onChange={(e) => {
                      setInput(e.currentTarget.value);
                      setCursorPosition(e.currentTarget.selectionStart ?? 0);
                    }}
                    onKeyDown={(e) => {
                      // Let suggestions handle keyboard events first
                      if (handleSuggestionsKeyDown(e)) {
                        return;
                      }
                      // Handle form submission
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        e.currentTarget.form?.requestSubmit();
                      }
                    }}
                    onKeyUp={(e) => {
                      setCursorPosition(e.currentTarget.selectionStart ?? 0);
                    }}
                    onClick={(e) => {
                      setCursorPosition(e.currentTarget.selectionStart ?? 0);
                    }}
                    onPaste={(e) => {
                      const items = e.clipboardData?.items;
                      if (!items) return;
                      for (const item of items) {
                        if (isValidImageType(item.type)) {
                          const file = item.getAsFile();
                          if (file) {
                            e.preventDefault();
                            addImage(file).catch(() => {
                              // Silently ignore paste errors - rare edge case
                            });
                          }
                        }
                      }
                    }}
                    disabled={status === "streaming"}
                    className="w-full resize-none overflow-y-auto bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none"
                    style={{ minHeight: "24px" }}
                  />
                </div>

                {/* Bottom toolbar */}
                <div className="flex items-center justify-between px-3 pb-2">
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={openFilePicker}
                      className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                    >
                      <Paperclip className="h-4 w-4" />
                    </Button>
                    {task.modelId && (
                      <span className="text-xs text-muted-foreground/60">
                        {task.modelId}
                      </span>
                    )}
                    {/* TODO: Derive context limit from model ID instead of hardcoding */}
                    <ContextUsageIndicator
                      inputTokens={tokenUsage.inputTokens}
                      outputTokens={tokenUsage.outputTokens}
                      contextLimit={200_000}
                    />
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={handleMicClick}
                      disabled={recordingState === "processing"}
                      className={`relative h-8 w-8 rounded-full ${
                        recordingState === "recording"
                          ? "text-red-500"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {recordingState === "recording" && (
                        <span className="absolute inset-0 animate-pulse rounded-full bg-red-500/30" />
                      )}
                      {recordingState === "processing" ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Mic className="h-5 w-5" />
                      )}
                    </Button>

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
                        disabled={!input.trim() && images.length === 0}
                        className="h-8 w-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </form>

              {/* Recording error message */}
              {recordingError && (
                <p className="mt-2 text-sm text-destructive">
                  {recordingError}
                </p>
              )}
            </div>
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
      {showDiffPanel && (sandboxInfo || Boolean(task.cachedDiff)) && (
        <DiffViewer
          sandboxId={sandboxInfo?.sandboxId}
          refreshKey={diffRefreshKey}
          onClose={() => setShowDiffPanel(false)}
        />
      )}
    </div>
  );
}
