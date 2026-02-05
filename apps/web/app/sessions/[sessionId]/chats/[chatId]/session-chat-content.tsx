"use client";

import type { AskUserQuestionInput, TaskToolUIPart } from "@open-harness/agent";
import { isToolUIPart } from "ai";
import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  FolderGit2,
  GitCompare,
  GitPullRequest,
  Loader2,
  MessageSquare,
  Mic,
  Paperclip,
  Pencil,
  Plus,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { ComponentProps, ReactNode } from "react";
import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { BundledTheme } from "shiki";
import { Streamdown } from "streamdown";
import type { WebAgentUIMessagePart, WebAgentUIToolPart } from "@/app/types";
import { CreatePRDialog } from "@/components/create-pr-dialog";
import { CreateRepoDialog } from "@/components/create-repo-dialog";
import { FileSuggestionsDropdown } from "@/components/file-suggestions-dropdown";
import { ImageAttachmentsPreview } from "@/components/image-attachments-preview";
import { ModelSelectorCompact } from "@/components/model-selector-compact";
import { QuestionPanel } from "@/components/question-panel";
import { TaskGroupView } from "@/components/task-group-view";
import { ToolCall } from "@/components/tool-call";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAudioRecording } from "@/hooks/use-audio-recording";
import { useFileSuggestions } from "@/hooks/use-file-suggestions";
import { useImageAttachments } from "@/hooks/use-image-attachments";
import { useScrollToBottom } from "@/hooks/use-scroll-to-bottom";
import { useSessionChats } from "@/hooks/use-session-chats";
import { ACCEPT_IMAGE_TYPES, isValidImageType } from "@/lib/image-utils";
import {
  AUTO_EXTEND_THRESHOLD_MS,
  DEFAULT_SANDBOX_TIMEOUT_MS,
} from "@/lib/sandbox/config";
import { DiffViewer } from "./diff-viewer";
import {
  type SandboxInfo,
  useSessionChatContext,
} from "./session-chat-context";

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

type CreateSandboxResponse = SandboxInfo & {
  type: "just-bash" | "vercel" | "hybrid";
};

async function createSandbox(
  cloneUrl: string | undefined,
  branch: string | undefined,
  isNewBranch: boolean,
  sessionId: string,
  sandboxType?: string,
): Promise<CreateSandboxResponse> {
  const response = await fetch("/api/sandbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repoUrl: cloneUrl,
      branch: cloneUrl ? (branch ?? "main") : undefined,
      isNewBranch: cloneUrl ? isNewBranch : false,
      sessionId,
      sandboxType: sandboxType ?? "hybrid",
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Failed to create sandbox: ${response.status}${text ? ` - ${text}` : ""}`,
    );
  }
  const data = (await response.json()) as {
    mode: "just-bash" | "vercel" | "hybrid";
  } & SandboxInfo;
  return { ...data, type: data.mode };
}

function isSandboxValid(sandboxInfo: SandboxInfo | null): boolean {
  if (!sandboxInfo) return false;
  if (sandboxInfo.timeout === null) return true; // No timeout = always valid
  const expiresAt = sandboxInfo.createdAt + sandboxInfo.timeout;
  return Date.now() < expiresAt - 10_000;
}

function useSandboxTimeRemaining(sandboxInfo: SandboxInfo | null) {
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!sandboxInfo || sandboxInfo.timeout === null) {
      setTimeRemaining(null);
      return;
    }

    const { createdAt, timeout } = sandboxInfo;

    const updateTime = () => {
      const expiresAt = createdAt + timeout;
      const remaining = expiresAt - Date.now();
      setTimeRemaining(remaining > 0 ? remaining : 0);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [sandboxInfo]);

  return timeRemaining;
}

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
  sandboxType,
  isCreating,
  isSavingSnapshot,
  isRestoring,
  isExtending,
  timeRemaining,
  onExtend,
  onSaveAndKill,
}: {
  sandboxInfo: SandboxInfo | null;
  sandboxType?: string;
  isCreating: boolean;
  isSavingSnapshot: boolean;
  isRestoring: boolean;
  isExtending: boolean;
  timeRemaining: number | null;
  onExtend: () => Promise<boolean>;
  onSaveAndKill: () => void;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const hasAutoSavedRef = useRef(false);
  const hasAutoExtendedRef = useRef(false);
  const autoExtendRetryCountRef = useRef(0);
  const MAX_AUTO_EXTEND_RETRIES = 3;

  // Reset auto-save flag when sandbox changes
  useEffect(() => {
    hasAutoSavedRef.current = false;
  }, [sandboxInfo]);

  // Reset auto-extend flag when sandbox changes or time goes back up (after successful extend)
  useEffect(() => {
    if (
      !sandboxInfo ||
      timeRemaining === null ||
      timeRemaining > AUTO_EXTEND_THRESHOLD_MS
    ) {
      hasAutoExtendedRef.current = false;
      autoExtendRetryCountRef.current = 0;
    }
  }, [sandboxInfo, timeRemaining]);

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

  // Auto-extend when window is visible and time is low
  useEffect(() => {
    const tryAutoExtend = async () => {
      if (
        timeRemaining !== null &&
        timeRemaining > 0 &&
        timeRemaining <= AUTO_EXTEND_THRESHOLD_MS &&
        !hasAutoExtendedRef.current &&
        !isExtending &&
        document.visibilityState === "visible"
      ) {
        hasAutoExtendedRef.current = true;
        const success = await onExtend();
        // Allow retry on failure, up to max retries
        if (!success) {
          autoExtendRetryCountRef.current += 1;
          if (autoExtendRetryCountRef.current < MAX_AUTO_EXTEND_RETRIES) {
            hasAutoExtendedRef.current = false;
          }
        }
      }
    };

    // Check immediately
    tryAutoExtend();

    // Also check when visibility changes (user returns to tab)
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        tryAutoExtend();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [timeRemaining, isExtending, onExtend]);

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
  // Note: timeRemaining is null for just-bash (no timeout), so check timeout !== null
  if (
    !sandboxInfo ||
    (sandboxInfo.timeout !== null &&
      (timeRemaining === null || timeRemaining <= 0))
  ) {
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

  // For just-bash (no timeout), skip countdown logic and show active state
  if (sandboxInfo.timeout === null) {
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
            Sandbox active (in-memory)
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  // At this point timeout is not null, so timeRemaining must be a number
  // (we returned early for null timeout above, and the inactive check handles null/0 timeRemaining)
  if (timeRemaining === null) return null;

  // Active - show green dot with X on hover (no countdown displayed, auto-extend handles it)
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
          {sandboxType ? `Sandbox active (${sandboxType})` : "Sandbox active"}
        </TooltipContent>
      </Tooltip>

      {/* X button on hover (not shown for in-memory sandboxes) */}
      {isHovered && sandboxType !== "just-bash" && (
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

export function SessionChatContent() {
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
    session,
    chatInfo,
    chat,
    sandboxInfo,
    setSandboxInfo,
    clearSandboxInfo,
    archiveSession,
    updateSessionTitle,
    updateChatModel,
    hadInitialMessages,
    diff,
    refreshDiff,
    files,
    filesLoading,
    refreshFiles,
    updateSessionSnapshot,
    setSandboxType,
    reconnectionStatus,
    attemptReconnection,
  } = useSessionChatContext();
  const sandboxTimeRemaining = useSandboxTimeRemaining(sandboxInfo);
  const {
    messages,
    error,
    sendMessage,
    status,
    addToolApprovalResponse,
    addToolOutput,
    stop,
  } = chat;
  const {
    chats,
    createChat,
    renameChat,
    deleteChat,
    loading: chatsLoading,
    refreshChats,
  } = useSessionChats(session.id);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingChatTitle, setEditingChatTitle] = useState("");
  const [isUpdatingModel, setIsUpdatingModel] = useState(false);
  const chatTitleInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingChatId && chatTitleInputRef.current) {
      chatTitleInputRef.current.focus();
      chatTitleInputRef.current.select();
    }
  }, [editingChatId]);

  // Refresh chats list when the first message completes to pick up the auto-generated title
  useEffect(() => {
    if (
      !hadInitialMessages &&
      status === "ready" &&
      messages.some((m) => m.role === "assistant")
    ) {
      refreshChats();
    }
  }, [hadInitialMessages, status, messages, refreshChats]);

  const handleChatSwitch = useCallback(
    (nextChatId: string) => {
      if (nextChatId === chatInfo.id) return;
      router.push(`/sessions/${session.id}/chats/${nextChatId}`);
    },
    [router, session.id, chatInfo.id],
  );

  const handleCreateChat = useCallback(async () => {
    try {
      const newChat = await createChat();
      router.push(`/sessions/${session.id}/chats/${newChat.id}`);
    } catch (err) {
      console.error("Failed to create chat:", err);
    }
  }, [createChat, router, session.id]);

  const handleRenameChat = useCallback(
    async (targetChatId: string, nextTitle: string) => {
      const trimmedTitle = nextTitle.trim();
      if (!trimmedTitle) {
        setEditingChatId(null);
        return;
      }
      try {
        await renameChat(targetChatId, trimmedTitle);
      } catch (err) {
        console.error("Failed to rename chat:", err);
      } finally {
        setEditingChatId(null);
      }
    },
    [renameChat],
  );

  const handleDeleteChat = useCallback(
    async (targetChatId: string) => {
      if (chats.length <= 1) return;
      const targetChat = chats.find((c) => c.id === targetChatId);
      const confirmed = window.confirm(
        `Delete chat "${targetChat?.title ?? "Untitled"}"?`,
      );
      if (!confirmed) return;

      const fallbackChat = chats.find((c) => c.id !== targetChatId);
      try {
        await deleteChat(targetChatId);
        if (targetChatId === chatInfo.id && fallbackChat) {
          router.replace(`/sessions/${session.id}/chats/${fallbackChat.id}`);
        }
      } catch (err) {
        console.error("Failed to delete chat:", err);
      }
    },
    [chats, deleteChat, chatInfo.id, router, session.id],
  );

  const handleModelChange = useCallback(
    async (modelId: string) => {
      if (!modelId || modelId === chatInfo.modelId) return;
      try {
        setIsUpdatingModel(true);
        await updateChatModel(modelId);
      } catch (err) {
        console.error("Failed to update chat model:", err);
      } finally {
        setIsUpdatingModel(false);
      }
    },
    [chatInfo.modelId, updateChatModel],
  );

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
    files,
    onSelect: handleFileSelect,
  });

  const handleKillSandbox = useCallback(async () => {
    if (!sandboxInfo) return;
    try {
      await fetch("/api/sandbox", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
        }),
      });
    } finally {
      clearSandboxInfo();
    }
  }, [sandboxInfo, session.id, clearSandboxInfo]);

  const saveSnapshot = useCallback(async (): Promise<{
    success: boolean;
    downloadUrl?: string;
    createdAt?: number;
  }> => {
    try {
      const response = await fetch("/api/sandbox/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
        }),
      });

      if (!response.ok) {
        const error = (await response.json()) as { error?: string };
        console.error("Failed to save snapshot:", error.error);
        return { success: false };
      }
      const data = (await response.json()) as {
        snapshotId: string;
        createdAt: number;
      };
      return {
        success: true,
        downloadUrl: data.snapshotId,
        createdAt: data.createdAt,
      };
    } catch (err) {
      console.error("Failed to save snapshot:", err);
      return { success: false };
    }
  }, [session.id]);

  const handleSaveAndKill = useCallback(async () => {
    if (!sandboxInfo || isSavingSnapshotRef.current) return;

    // Only save snapshot for sandbox types that support it
    // just-bash state is already persisted after each message via getState()
    const supportsSnapshot = session.sandboxState?.type !== "just-bash";

    if (supportsSnapshot) {
      isSavingSnapshotRef.current = true;
      setIsSavingSnapshot(true);
      try {
        const result = await saveSnapshot();
        if (result.success && result.downloadUrl && result.createdAt) {
          updateSessionSnapshot(result.downloadUrl, new Date(result.createdAt));
        }
      } finally {
        setIsSavingSnapshot(false);
        isSavingSnapshotRef.current = false;
      }
    }

    // Kill sandbox (regardless of save result or type)
    await handleKillSandbox();
  }, [
    sandboxInfo,
    session.sandboxState?.type,
    updateSessionSnapshot,
    handleKillSandbox,
    saveSnapshot,
  ]);

  const handleExtendSandbox = useCallback(async (): Promise<boolean> => {
    if (!sandboxInfo) return false;
    setIsExtendingSandbox(true);
    try {
      const response = await fetch("/api/sandbox/extend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
        }),
      });

      if (!response.ok) {
        const error = (await response.json()) as { error?: string };
        console.error("Failed to extend sandbox:", error.error);
        return false;
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
      return true;
    } catch (err) {
      console.error("Failed to extend sandbox:", err);
      return false;
    } finally {
      setIsExtendingSandbox(false);
    }
  }, [sandboxInfo, session.id, setSandboxInfo]);

  const [restoreError, setRestoreError] = useState<string | null>(null);
  const isSavingSnapshotRef = useRef(false);

  const handleRestoreSnapshot = async () => {
    if (!session.snapshotUrl) return;

    setIsRestoringSnapshot(true);
    setRestoreError(null);

    try {
      // Restore from snapshot directly - this creates a new sandbox from the snapshot
      // Do NOT create a sandbox first, as that would set sandboxId which prevents
      // the snapshot restoration from working correctly
      const response = await fetch("/api/sandbox/snapshot", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
        }),
      });

      if (!response.ok) {
        const error = (await response.json()) as { error?: string };
        const errorMsg = error.error ?? "Unknown error";
        setRestoreError(`Snapshot restore failed: ${errorMsg}`);
        return;
      }

      // Set sandbox info for the restored sandbox
      setSandboxInfo({
        createdAt: Date.now(),
        timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
      });

      // Update sandbox type from the preserved state
      if (session.sandboxState?.type) {
        setSandboxType(session.sandboxState.type);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setRestoreError(`Failed to restore snapshot: ${errorMsg}`);
    } finally {
      setIsRestoringSnapshot(false);
    }
  };

  const handleCreateNewSandbox = useCallback(async () => {
    setIsCreatingSandbox(true);
    try {
      const branchExistsOnOrigin = session.prNumber != null;
      const shouldCreateNewBranch =
        session.isNewBranch && !branchExistsOnOrigin;
      const newSandbox = await createSandbox(
        session.cloneUrl ?? undefined,
        session.branch ?? undefined,
        shouldCreateNewBranch,
        session.id,
        session.sandboxState?.type ?? "hybrid",
      );
      setSandboxInfo(newSandbox);
      setSandboxType(newSandbox.type);
    } catch (err) {
      console.error("Failed to create sandbox:", err);
    } finally {
      setIsCreatingSandbox(false);
    }
  }, [
    session.prNumber,
    session.isNewBranch,
    session.cloneUrl,
    session.branch,
    session.id,
    session.sandboxState?.type,
    setSandboxInfo,
    setSandboxType,
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

  // Track whether we've auto-attempted sandbox startup for this page load.
  const hasAutoStartedSandboxRef = useRef(false);

  // Attempt to reconnect to existing sandbox if session has saved state.
  useEffect(() => {
    if (
      session.sandboxState &&
      !sandboxInfo &&
      !isCreatingSandbox &&
      reconnectionStatus === "idle"
    ) {
      attemptReconnection();
    }
  }, [
    session.sandboxState,
    sandboxInfo,
    isCreatingSandbox,
    reconnectionStatus,
    attemptReconnection,
  ]);

  const ensureSandboxReady = useCallback(async () => {
    if (isSandboxValid(sandboxInfo)) {
      return true;
    }
    if (isCreatingSandbox) {
      return false;
    }
    try {
      setIsCreatingSandbox(true);
      const branchExistsOnOrigin = session.prNumber != null;
      const shouldCreateNewBranch =
        session.isNewBranch && !branchExistsOnOrigin;
      const newSandbox = await createSandbox(
        session.cloneUrl ?? undefined,
        session.branch ?? undefined,
        shouldCreateNewBranch,
        session.id,
        session.sandboxState?.type ?? "hybrid",
      );
      setSandboxInfo(newSandbox);
      setSandboxType(newSandbox.type);
      return true;
    } catch (err) {
      console.error("Failed to create sandbox:", err);
      return false;
    } finally {
      setIsCreatingSandbox(false);
    }
  }, [
    sandboxInfo,
    isCreatingSandbox,
    session.prNumber,
    session.isNewBranch,
    session.cloneUrl,
    session.branch,
    session.id,
    session.sandboxState?.type,
    setSandboxInfo,
    setSandboxType,
  ]);

  // Auto-create sandbox right away for new sessions/chats.
  useEffect(() => {
    if (hasAutoStartedSandboxRef.current) return;
    if (sandboxInfo || isCreatingSandbox) return;

    // If we have stored sandbox state, wait for reconnect attempt first.
    if (session.sandboxState && reconnectionStatus === "idle") return;
    if (session.sandboxState && reconnectionStatus === "checking") return;
    if (session.sandboxState && reconnectionStatus === "connected") {
      hasAutoStartedSandboxRef.current = true;
      return;
    }

    hasAutoStartedSandboxRef.current = true;
    void ensureSandboxReady();
  }, [
    session.sandboxState,
    reconnectionStatus,
    sandboxInfo,
    isCreatingSandbox,
    ensureSandboxReady,
  ]);

  // Track tool completions to trigger diff refresh
  const prevToolStatesRef = useRef<Map<string, string>>(new Map());
  const hasInitializedToolStatesRef = useRef(false);
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
    if (!hasInitializedToolStatesRef.current) {
      prevToolStatesRef.current = currentToolStates;
      hasInitializedToolStatesRef.current = true;
      return;
    }

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
      // Auto-open diff panel on first file change (not for in-memory sandboxes)
      if (
        !showDiffPanel &&
        !hasAutoOpenedDiffRef.current &&
        sandboxInfo &&
        session.sandboxState?.type !== "just-bash"
      ) {
        hasAutoOpenedDiffRef.current = true;
        setShowDiffPanel(true);
      }
      // Refresh diff and files when files change.
      // Fire-and-forget with error handling - SWR updates error state internally,
      // but we catch here to prevent unhandled rejection warnings.
      refreshDiff().catch(() => {});
      refreshFiles().catch(() => {});
    }
  }, [
    currentToolStates,
    messages,
    showDiffPanel,
    sandboxInfo,
    session.sandboxState?.type,
    refreshDiff,
    refreshFiles,
  ]);

  // Note: SWR handles automatic fetching when sandbox becomes available
  // and caching/deduplication of requests

  // Get token usage from the most recent assistant message (current context usage)
  const tokenUsage = useMemo(() => {
    // Find the last assistant message with usage metadata
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message?.role === "assistant" && message.metadata?.lastStepUsage) {
        return {
          inputTokens: message.metadata.lastStepUsage.inputTokens ?? 0,
          outputTokens: message.metadata.lastStepUsage.outputTokens ?? 0,
        };
      }
    }
    return { inputTokens: 0, outputTokens: 0 };
  }, [messages]);

  // Detect pending AskUserQuestion tool calls
  const { hasPendingQuestion, pendingQuestionPart, questionToolCallId } =
    useMemo(() => {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage?.role === "assistant") {
        for (const p of lastMessage.parts) {
          if (
            isToolUIPart(p) &&
            p.type === "tool-ask_user_question" &&
            p.state === "input-available"
          ) {
            return {
              hasPendingQuestion: true,
              pendingQuestionPart: p as {
                type: "tool-ask_user_question";
                toolCallId: string;
                input: AskUserQuestionInput;
              },
              questionToolCallId: p.toolCallId,
            };
          }
        }
      }
      return {
        hasPendingQuestion: false,
        pendingQuestionPart: null,
        questionToolCallId: null,
      };
    }, [messages]);

  // Handle question submission
  const handleQuestionSubmit = useCallback(
    (answers: Record<string, string | string[]>) => {
      if (questionToolCallId) {
        addToolOutput({
          tool: "ask_user_question",
          toolCallId: questionToolCallId,
          output: { answers },
        });
      }
    },
    [questionToolCallId, addToolOutput],
  );

  // Handle question cancellation
  const handleQuestionCancel = useCallback(() => {
    if (questionToolCallId) {
      addToolOutput({
        tool: "ask_user_question",
        toolCallId: questionToolCallId,
        output: { declined: true },
      });
    }
  }, [questionToolCallId, addToolOutput]);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-destructive">{error.message}</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="hidden w-72 shrink-0 border-r border-border bg-muted/20 md:flex md:flex-col">
        <div className="border-b border-border p-3">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="mb-3 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Sessions
          </button>
          {isEditingTitle ? (
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
                        await updateSessionTitle(editedTitle.trim());
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
                  if (editedTitle.trim() && editedTitle !== session.title) {
                    try {
                      await updateSessionTitle(editedTitle.trim());
                    } catch (err) {
                      console.error("Failed to update title:", err);
                    }
                  }
                  setIsEditingTitle(false);
                }}
                className="h-8 flex-1 rounded border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                type="button"
                onClick={async () => {
                  if (editedTitle.trim()) {
                    try {
                      await updateSessionTitle(editedTitle.trim());
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
            <button
              type="button"
              onClick={() => {
                setEditedTitle(session.title);
                setIsEditingTitle(true);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
            >
              <span className="truncate text-sm font-medium">
                {session.title}
              </span>
              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCreateChat}
            disabled={chatsLoading}
            className="mt-3 w-full justify-start"
          >
            <Plus className="mr-2 h-4 w-4" />
            New chat
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <div className="space-y-1">
            {chats.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center gap-1 rounded-md pr-1 ${
                  c.id === chatInfo.id ? "bg-secondary" : "hover:bg-muted"
                }`}
              >
                {editingChatId === c.id ? (
                  <input
                    ref={chatTitleInputRef}
                    type="text"
                    value={editingChatTitle}
                    onChange={(e) => setEditingChatTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleRenameChat(c.id, editingChatTitle);
                      } else if (e.key === "Escape") {
                        setEditingChatId(null);
                      }
                    }}
                    onBlur={() => {
                      void handleRenameChat(c.id, editingChatTitle);
                    }}
                    className="h-8 min-w-0 flex-1 rounded bg-transparent px-2 text-sm focus:outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => handleChatSwitch(c.id)}
                    className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors ${
                      c.id === chatInfo.id
                        ? "text-secondary-foreground"
                        : "text-muted-foreground group-hover:text-foreground"
                    }`}
                  >
                    <MessageSquare className="h-4 w-4 shrink-0" />
                    <span className="truncate">{c.title}</span>
                  </button>
                )}
                {editingChatId !== c.id && (
                  <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingChatId(c.id);
                        setEditingChatTitle(c.title);
                      }}
                      className="rounded p-1.5 text-muted-foreground hover:bg-background/60 hover:text-foreground"
                      aria-label={`Rename ${c.title}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleDeleteChat(c.id);
                      }}
                      disabled={chats.length <= 1}
                      className="rounded p-1.5 text-muted-foreground hover:bg-background/60 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={`Delete ${c.title}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Main chat area */}
      <div className="flex flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              {session.repoName ? (
                <>
                  <span className="font-medium text-foreground">
                    {session.repoName}
                  </span>
                  {(session.branch ?? sandboxInfo?.currentBranch) && (
                    <>
                      <span className="text-muted-foreground/40">/</span>
                      <span className="text-muted-foreground">
                        {session.branch ?? sandboxInfo?.currentBranch}
                      </span>
                    </>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground">{session.title}</span>
              )}
            </div>
            <div className="flex items-center gap-2 md:hidden">
              <Select value={chatInfo.id} onValueChange={handleChatSwitch}>
                <SelectTrigger className="h-8 w-[160px]">
                  <SelectValue placeholder="Select chat" />
                </SelectTrigger>
                <SelectContent>
                  {chats.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleCreateChat}
                disabled={chatsLoading}
                className="h-8 w-8"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <SandboxHeaderBadge
              sandboxInfo={sandboxInfo}
              sandboxType={session.sandboxState?.type}
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
                // Stop sandbox if active (save snapshot first)
                if (sandboxInfo) {
                  await handleSaveAndKill();
                }
                await archiveSession();
                router.push("/");
              }}
            >
              <Archive className="mr-2 h-4 w-4" />
              Archive
            </Button>
            {session.sandboxState?.type === "just-bash" ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button variant="ghost" size="sm" disabled>
                      <GitCompare className="mr-2 h-4 w-4" />
                      Diff
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={8}>
                  Not available for in-memory sandboxes
                </TooltipContent>
              </Tooltip>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDiffPanel(!showDiffPanel)}
                disabled={!diff && !session.cachedDiff}
              >
                <GitCompare className="mr-2 h-4 w-4" />
                Diff
                {diff &&
                  (diff.summary.totalAdditions > 0 ||
                    diff.summary.totalDeletions > 0) && (
                    <span className="ml-2 text-xs">
                      <span className="text-green-500">
                        +{diff.summary.totalAdditions}
                      </span>{" "}
                      <span className="text-red-400">
                        -{diff.summary.totalDeletions}
                      </span>
                    </span>
                  )}
              </Button>
            )}
            {session?.cloneUrl ? (
              // Session has a repo - show PR buttons
              session?.prNumber ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const prUrl = `https://github.com/${session.repoOwner}/${session.repoName}/pull/${session.prNumber}`;
                    window.open(prUrl, "_blank");
                  }}
                >
                  <GitPullRequest className="mr-2 h-4 w-4" />
                  View PR #{session.prNumber}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPrDialogOpen(true)}
                  disabled={!session?.branch}
                >
                  <GitPullRequest className="mr-2 h-4 w-4" />
                  Create PR
                </Button>
              )
            ) : session.sandboxState?.type === "just-bash" ? null : (
              // Session has no repo - show Create Repo button (not available for in-memory sandboxes)
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

        {/* Question Panel */}
        {hasPendingQuestion && pendingQuestionPart && (
          <QuestionPanel
            questions={pendingQuestionPart.input.questions}
            onSubmit={handleQuestionSubmit}
            onCancel={handleQuestionCancel}
          />
        )}

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
                  isLoading={filesLoading}
                />
              )}
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const hasContent = input.trim() || images.length > 0;
                  if (!hasContent) return;

                  const ready = await ensureSandboxReady();
                  if (!ready) return;

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
                  hasSnapshot={!!session.snapshotUrl}
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
                    {messages.length === 0 && chatInfo.modelId ? (
                      <div
                        className={
                          status === "streaming" || isUpdatingModel
                            ? "pointer-events-none opacity-60"
                            : undefined
                        }
                      >
                        <ModelSelectorCompact
                          value={chatInfo.modelId}
                          onChange={(modelId) => {
                            void handleModelChange(modelId);
                          }}
                        />
                      </div>
                    ) : (
                      chatInfo.modelId && (
                        <span className="text-xs text-muted-foreground/60">
                          {chatInfo.modelId}
                        </span>
                      )
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
                        disabled={
                          (!input.trim() && images.length === 0) ||
                          isUpdatingModel
                        }
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
      {session && (
        <CreatePRDialog
          open={prDialogOpen}
          onOpenChange={setPrDialogOpen}
          session={session}
          hasSandbox={sandboxInfo !== null}
        />
      )}

      {/* Create Repo Dialog */}
      {session && (
        <CreateRepoDialog
          open={repoDialogOpen}
          onOpenChange={setRepoDialogOpen}
          session={session}
          hasSandbox={sandboxInfo !== null}
        />
      )}

      {/* Diff Viewer Panel */}
      {showDiffPanel && (sandboxInfo || Boolean(session.cachedDiff)) && (
        <DiffViewer onClose={() => setShowDiffPanel(false)} />
      )}
    </div>
  );
}
