"use client";

import type { AskUserQuestionInput, TaskToolUIPart } from "@open-harness/agent";
import { isReasoningUIPart, isToolUIPart, type FileUIPart } from "ai";
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  EllipsisVertical,
  ExternalLink,
  FolderGit2,
  GitCommit,
  GitCompare,
  GitPullRequest,
  Link2,
  Loader2,
  MessageSquareMore,
  Mic,
  Paperclip,
  Plus,
  RefreshCw,
  RotateCcw,
  Share2,
  Square,
  Trash2,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  WebAgentUIMessage,
  WebAgentUIMessagePart,
  WebAgentUIToolPart,
} from "@/app/types";
import { FileSuggestionsDropdown } from "@/components/file-suggestions-dropdown";
import { ImageAttachmentsPreview } from "@/components/image-attachments-preview";
import { ModelSelectorCompact } from "@/components/model-selector-compact";
import { QuestionPanel } from "@/components/question-panel";
import { SlashCommandDropdown } from "@/components/slash-command-dropdown";
import { TaskGroupView } from "@/components/task-group-view";
import { ThinkingBlock } from "@/components/thinking-block";
import { ToolCall } from "@/components/tool-call";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useSessionLayout } from "@/app/sessions/[sessionId]/session-layout-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarTrigger } from "@/components/ui/sidebar";
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
import { useSlashCommands } from "@/hooks/use-slash-commands";
import {
  isChatInFlight as isChatInFlightStatus,
  shouldShowThinkingIndicator,
} from "@/lib/chat-streaming-state";
import { ACCEPT_IMAGE_TYPES, isValidImageType } from "@/lib/image-utils";
import { DEFAULT_CONTEXT_LIMIT } from "@/lib/models";
import { DEFAULT_SANDBOX_TIMEOUT_MS } from "@/lib/sandbox/config";
import { streamdownPlugins } from "@/lib/streamdown-config";
import { cn } from "@/lib/utils";
import {
  type SandboxInfo,
  useSessionChatContext,
} from "./session-chat-context";
import "streamdown/styles.css";

const DiffViewer = dynamic(
  () => import("./diff-viewer").then((m) => m.DiffViewer),
  { ssr: false },
);
const CreatePRDialog = dynamic(
  () => import("@/components/create-pr-dialog").then((m) => m.CreatePRDialog),
  { ssr: false },
);
const CommitDialog = dynamic(
  () => import("@/components/commit-dialog").then((m) => m.CommitDialog),
  { ssr: false },
);
const CreateRepoDialog = dynamic(
  () =>
    import("@/components/create-repo-dialog").then((m) => m.CreateRepoDialog),
  { ssr: false },
);
const Streamdown = dynamic(
  () => import("streamdown").then((m) => m.Streamdown),
  { ssr: false },
);

const STREAM_RECOVERY_STALL_MS = 4_000;
const STREAM_RECOVERY_MIN_INTERVAL_MS = 8_000;

const emptySubscribe = () => () => {};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isChatStreamingProbeResponse(value: unknown): value is {
  chats: { id: string; isStreaming: boolean }[];
} {
  if (!isObjectRecord(value)) {
    return false;
  }

  const chats = value["chats"];
  if (!Array.isArray(chats)) {
    return false;
  }

  return chats.every(
    (chat) =>
      isObjectRecord(chat) &&
      typeof chat["id"] === "string" &&
      typeof chat["isStreaming"] === "boolean",
  );
}

function useHasMounted() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

type MessageRenderGroup =
  | {
      type: "part";
      part: WebAgentUIMessagePart;
      index: number;
      renderKey: string;
    }
  | {
      type: "task-group";
      tasks: TaskToolUIPart[];
      startIndex: number;
      renderKey: string;
    };

interface GroupedRenderMessage {
  message: WebAgentUIMessage;
  groups: MessageRenderGroup[];
  isStreaming: boolean;
}

function getPartIdentity(part: WebAgentUIMessagePart): string {
  if (isToolUIPart(part)) {
    return part.toolCallId ? `tool:${part.toolCallId}` : `tool:${part.type}`;
  }

  if (isReasoningUIPart(part)) {
    return "reasoning";
  }

  if (part.type === "text") {
    return "text";
  }

  if (part.type === "file") {
    if (part.url) return `file:${part.url}`;
    if (part.filename) return `file:${part.filename}`;
    return "file";
  }

  return `part:${part.type}`;
}

type CreateSandboxResponse = SandboxInfo & {
  type: string;
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
    mode: string;
  } & SandboxInfo;
  return { ...data, type: data.mode };
}

function isSandboxValid(sandboxInfo: SandboxInfo | null): boolean {
  if (!sandboxInfo) return false;
  if (sandboxInfo.timeout === null) return true; // No timeout = always valid
  const expiresAt = sandboxInfo.createdAt + sandboxInfo.timeout;
  return Date.now() < expiresAt;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return tokens.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  isActive,
  isCreating,
  isRestoring,
  isReconnecting,
  isHibernating,
}: {
  sandboxInfo: SandboxInfo | null;
  isActive: boolean;
  isCreating: boolean;
  isRestoring: boolean;
  isReconnecting: boolean;
  isHibernating: boolean;
}) {
  // Creating/restoring/transition state.
  if (isCreating || isRestoring || isReconnecting || isHibernating) {
    const transitionLabel = isHibernating
      ? "Hibernating sandbox..."
      : isReconnecting
        ? "Reconnecting sandbox..."
        : "Creating sandbox...";

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center justify-center">
            <Loader2 className="size-3 animate-spin text-yellow-500" />
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={8}>
          {isRestoring ? "Restoring sandbox..." : transitionLabel}
        </TooltipContent>
      </Tooltip>
    );
  }

  // Inactive - show gray dot
  if (!sandboxInfo || !isActive) {
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

  // Active - show green dot
  return (
    <div className="flex items-center gap-1">
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
    </div>
  );
}

function SandboxInputOverlay({
  isSandboxActive,
  isCreating,
  isRestoring,
  isReconnecting,
  isHibernating,
  isArchived,
  isInitializing,
  snapshotPending,
  hasSnapshot,
  onRestore,
  onCreateNew,
}: {
  isSandboxActive: boolean;
  isCreating: boolean;
  isRestoring: boolean;
  isReconnecting: boolean;
  isHibernating: boolean;
  isArchived: boolean;
  isInitializing: boolean;
  snapshotPending: boolean;
  hasSnapshot: boolean;
  onRestore: () => void;
  onCreateNew: () => void;
}) {
  if (isArchived) {
    return (
      <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-background/60 backdrop-blur-[2px]">
        <div className="flex items-center gap-3 rounded-full bg-background/90 px-4 py-2 text-muted-foreground shadow-sm">
          <Archive className="h-4 w-4" />
          <span className="text-sm">
            {snapshotPending
              ? "Snapshot in progress. Unarchive will be available in a few seconds."
              : "This session is archived. Unarchive it to resume."}
          </span>
        </div>
      </div>
    );
  }

  // During sandbox creation/restoration/reconnection/initialization, don't block the input.
  // The submit button is disabled separately, and the header badge shows status.
  if (
    isSandboxActive ||
    isCreating ||
    isRestoring ||
    isReconnecting ||
    isHibernating ||
    isInitializing
  ) {
    return null;
  }

  // Sandbox is fully inactive and not transitioning -- show resume/create buttons
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-background/60 backdrop-blur-[2px]">
      <div className="flex items-center gap-2">
        {hasSnapshot ? (
          <Button onClick={onRestore} size="sm" className="shadow-sm">
            Resume sandbox
          </Button>
        ) : (
          <Button
            onClick={onCreateNew}
            size="sm"
            variant="outline"
            className="shadow-sm"
          >
            Create sandbox
          </Button>
        )}
      </div>
    </div>
  );
}

function ShareDialog({
  sessionId,
  initialShareId,
  externalOpen,
  onExternalOpenChange,
}: {
  sessionId: string;
  initialShareId: string | null;
  externalOpen?: boolean;
  onExternalOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = externalOpen ?? internalOpen;
  const setOpen = onExternalOpenChange ?? setInternalOpen;
  const [shareId, setShareId] = useState(initialShareId);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState<string | null>(
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL}`
      : null,
  );

  useEffect(() => {
    if (!baseUrl) {
      setBaseUrl(window.location.origin);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  const shareUrl = shareId && baseUrl ? `${baseUrl}/shared/${shareId}` : null;

  async function enableSharing() {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/share`, {
        method: "POST",
      });
      if (!res.ok) {
        setError("Failed to enable sharing");
        return;
      }
      const data = (await res.json()) as { shareId: string };
      setShareId(data.shareId);
    } catch {
      setError("Failed to enable sharing");
    } finally {
      setIsLoading(false);
    }
  }

  async function disableSharing() {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/share`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError("Failed to disable sharing");
        return;
      }
      setShareId(null);
      setCopied(false);
    } catch {
      setError("Failed to disable sharing");
    } finally {
      setIsLoading(false);
    }
  }

  function copyLink() {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const isExternallyControlled = externalOpen !== undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isExternallyControlled && (
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm">
            <Share2 className="h-4 w-4 mr-2" />
            Share
          </Button>
        </DialogTrigger>
      )}
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Share session</DialogTitle>
          <DialogDescription>
            Anyone with the link can view the conversation in read-only mode.
          </DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {shareId ? (
          <>
            <div className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border bg-muted px-3 py-2 text-sm">
                <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{shareUrl}</span>
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={copyLink}
                className="shrink-0"
              >
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <DialogFooter className="flex-row justify-between sm:justify-between">
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => void disableSharing()}
                disabled={isLoading}
              >
                {isLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Revoke link
              </Button>
              <DialogClose asChild>
                <Button variant="outline" size="sm">
                  Close
                </Button>
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <DialogFooter>
            <Button
              onClick={() => void enableSharing()}
              disabled={isLoading}
              className="w-full"
            >
              {isLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Link2 className="mr-2 h-4 w-4" />
              )}
              Create share link
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function SessionChatContent(_props: unknown) {
  const router = useRouter();
  const {
    chats: mobileChats,
    createChat: mobileCreateChat,
    switchChat: mobileSwitchChat,
  } = useSessionLayout();
  const [input, setInput] = useState("");
  const [isCreatingSandbox, setIsCreatingSandbox] = useState(false);
  const [isRestoringSnapshot, setIsRestoringSnapshot] = useState(false);
  const [isUnarchiving, setIsUnarchiving] = useState(false);
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [prDialogOpen, setPrDialogOpen] = useState(false);
  const [repoDialogOpen, setRepoDialogOpen] = useState(false);
  const [showDiffPanel, setShowDiffPanel] = useState(false);
  const [mobileArchiveDialogOpen, setMobileArchiveDialogOpen] = useState(false);
  const [mobileShareOpen, setMobileShareOpen] = useState(false);
  const [mobileChatDrawerOpen, setMobileChatDrawerOpen] = useState(false);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const hasMounted = useHasMounted();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
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
    contextLimit,
    stopChatStream,
    retryChatStream,
    initialMessages,
    sandboxInfo,
    setSandboxInfo,
    archiveSession,
    unarchiveSession,
    updateChatModel,
    hadInitialMessages,
    diff,
    refreshDiff,
    gitStatus,
    refreshGitStatus,
    files,
    filesLoading,
    refreshFiles,
    skills,
    skillsLoading,
    preferredSandboxType,
    supportsDiff,
    supportsRepoCreation,
    hasRuntimeSandboxState,
    hasSnapshot,
    setSandboxTypeFromUnknown,
    reconnectionStatus,
    lifecycleTiming,
    syncSandboxStatus,
    attemptReconnection,
    updateSessionRepo,
    updateSessionPullRequest,
    checkBranchAndPr,
    models,
    modelsLoading,
  } = useSessionChatContext();
  const mobileActiveChatId = chatInfo.id;
  const handleMobileNewChat = () => {
    const { chat: newChat } = mobileCreateChat();
    mobileSwitchChat(newChat.id);
  };
  const {
    messages,
    error,
    sendMessage,
    setMessages,
    status,
    addToolApprovalResponse,
    addToolOutput,
  } = chat;
  const {
    markChatRead,
    setChatStreaming,
    setChatTitle,
    clearChatTitle,
    refreshChats,
  } = useSessionChats(session.id);
  const renderMessages = useMemo(
    () => (hasMounted ? messages : initialMessages),
    [hasMounted, messages, initialMessages],
  );
  const isChatInFlight = isChatInFlightStatus(status);
  const lastMessage = useMemo(
    () => renderMessages[renderMessages.length - 1],
    [renderMessages],
  );
  const hasAssistantRenderableContent = useMemo(
    () =>
      lastMessage?.role === "assistant"
        ? lastMessage.parts.some(
            (p) =>
              (p.type === "text" && p.text.length > 0) ||
              isToolUIPart(p) ||
              (isReasoningUIPart(p) &&
                (p.text.length > 0 || p.state === "streaming")),
          )
        : false,
    [lastMessage],
  );
  const hasSeenAssistantRenderableContentRef = useRef(false);
  const [hasPendingResponse, setHasPendingResponse] = useState(false);

  // Sync hasPendingResponse with the AI SDK status.
  // IMPORTANT: hasPendingResponse is intentionally excluded from the dependency
  // array. The form submit handler sets it to true optimistically (before
  // sendMessage is called), and including it here would cause the effect to
  // immediately clear it because status is still "ready" at that point —
  // resulting in a visible flicker of the thinking indicator and stop button.
  useEffect(() => {
    if (isChatInFlight) {
      setHasPendingResponse(true);
      return;
    }

    if (status === "error" || status === "ready") {
      setHasPendingResponse(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above
  }, [isChatInFlight, status]);

  useEffect(() => {
    if (!isChatInFlight && !hasPendingResponse) {
      hasSeenAssistantRenderableContentRef.current = false;
      return;
    }
    // Only mark content as "seen" once we're actually in-flight — not during
    // the optimistic pending phase where messages are still stale from the
    // previous turn (due to experimental_throttle).  Without this guard the
    // ref gets set to true from the *old* assistant message, which causes the
    // thinking indicator to disappear prematurely when the new (empty)
    // assistant message arrives.
    if (isChatInFlight && hasAssistantRenderableContent) {
      hasSeenAssistantRenderableContentRef.current = true;
    }
  }, [isChatInFlight, hasPendingResponse, hasAssistantRenderableContent]);

  const hasSeenAssistantRenderableContent =
    hasAssistantRenderableContent ||
    hasSeenAssistantRenderableContentRef.current;
  const effectiveStatus = hasPendingResponse ? "streaming" : status;
  const showThinkingIndicator = useMemo(() => {
    // During the optimistic pending phase (user just clicked send but the
    // AI SDK status hasn't caught up yet due to throttling), always show
    // the thinking indicator.  The messages are stale at this point so
    // shouldShowThinkingIndicator would make the wrong decision based on
    // the previous turn's content.
    if (hasPendingResponse && !isChatInFlight) {
      return true;
    }
    return shouldShowThinkingIndicator({
      status: effectiveStatus,
      hasAssistantRenderableContent: hasSeenAssistantRenderableContent,
      lastMessageRole: lastMessage?.role,
    });
  }, [
    effectiveStatus,
    hasSeenAssistantRenderableContent,
    lastMessage?.role,
    hasPendingResponse,
    isChatInFlight,
  ]);
  const groupedRenderMessages = useMemo<GroupedRenderMessage[]>(() => {
    return renderMessages.map((message, messageIndex) => {
      const groups: MessageRenderGroup[] = [];
      let currentTaskGroup: TaskToolUIPart[] = [];
      let taskGroupStartIndex = 0;
      let taskGroupOrdinal = 0;
      const partIdentityCounts = new Map<string, number>();

      const getStablePartRenderKey = (part: WebAgentUIMessagePart): string => {
        const identity = getPartIdentity(part);

        if (isToolUIPart(part) && part.toolCallId) {
          return identity;
        }

        const count = partIdentityCounts.get(identity) ?? 0;
        partIdentityCounts.set(identity, count + 1);
        return `${identity}:${count}`;
      };

      const flushTaskGroup = () => {
        if (currentTaskGroup.length === 0) return;

        const firstTaskId =
          currentTaskGroup.find((task) => task.toolCallId)?.toolCallId ?? null;

        groups.push({
          type: "task-group",
          tasks: currentTaskGroup,
          startIndex: taskGroupStartIndex,
          renderKey: firstTaskId
            ? `task-group:${firstTaskId}`
            : `task-group:${taskGroupOrdinal}`,
        });
        currentTaskGroup = [];
        taskGroupOrdinal += 1;
      };

      message.parts.forEach((part, index) => {
        if (isToolUIPart(part) && part.type === "tool-task") {
          if (currentTaskGroup.length === 0) {
            taskGroupStartIndex = index;
          }
          currentTaskGroup.push(part);
          return;
        }

        flushTaskGroup();
        groups.push({
          type: "part",
          part,
          index,
          renderKey: getStablePartRenderKey(part),
        });
      });

      flushTaskGroup();

      return {
        message,
        groups,
        isStreaming:
          isChatInFlight && messageIndex === renderMessages.length - 1,
      };
    });
  }, [renderMessages, isChatInFlight]);
  const [isUpdatingModel, setIsUpdatingModel] = useState(false);
  const lastStatusSyncAtRef = useRef(0);
  const statusSyncInFlightRef = useRef(false);
  const pendingOptimisticTitleChatIdRef = useRef<string | null>(null);
  const hasSetOptimisticTitleRef = useRef(false);
  const markReadRef = useRef<{
    lastAt: number;
    lastChatId: string | null;
    inFlight: boolean;
  }>({
    lastAt: 0,
    lastChatId: null,
    inFlight: false,
  });
  const inFlightStartedAtRef = useRef<number | null>(null);
  const lastStreamRecoveryAtRef = useRef(0);
  const streamRecoveryProbeInFlightRef = useRef(false);

  const requestStatusSync = useCallback(
    async (mode: "normal" | "force" = "normal"): Promise<void> => {
      const now = Date.now();
      if (statusSyncInFlightRef.current) return;
      if (mode === "normal" && now - lastStatusSyncAtRef.current < 5_000) {
        return;
      }

      statusSyncInFlightRef.current = true;
      try {
        await syncSandboxStatus();
        lastStatusSyncAtRef.current = Date.now();
      } finally {
        statusSyncInFlightRef.current = false;
      }
    },
    [syncSandboxStatus],
  );

  const requestMarkChatRead = useCallback(
    async (mode: "normal" | "force" = "normal"): Promise<void> => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }

      // For passive/background-triggered marks, require focus too.
      // Force marks run on route entry/turn completion and should not wait for
      // focus when the tab is already visible.
      if (
        mode === "normal" &&
        typeof document !== "undefined" &&
        !document.hasFocus()
      ) {
        return;
      }

      const now = Date.now();
      const isSameChat = markReadRef.current.lastChatId === chatInfo.id;
      if (markReadRef.current.inFlight) return;
      if (
        mode === "normal" &&
        isSameChat &&
        now - markReadRef.current.lastAt < 3_000
      ) {
        return;
      }

      markReadRef.current.inFlight = true;
      try {
        await markChatRead(chatInfo.id);
        markReadRef.current.lastAt = Date.now();
        markReadRef.current.lastChatId = chatInfo.id;
      } catch (err) {
        console.error("Failed to mark chat read:", err);
      } finally {
        markReadRef.current.inFlight = false;
      }
    },
    [chatInfo.id, markChatRead],
  );
  const requestMarkChatReadRef = useRef(requestMarkChatRead);

  useEffect(() => {
    requestMarkChatReadRef.current = requestMarkChatRead;
  }, [requestMarkChatRead]);

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

  useEffect(() => {
    void requestMarkChatReadRef.current("force");
  }, [chatInfo.id]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void requestMarkChatRead("normal");
      }
    };
    const handleWindowFocus = () => {
      void requestMarkChatRead("normal");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [requestMarkChatRead]);

  // Keep the recovery logic in a ref so event-listener effects never
  // churn during streaming.  The ref is updated on every render (cheap) while
  // the stable wrapper below keeps a constant identity for effects.
  const maybeRecoverStreamRef = useRef(() => {});
  maybeRecoverStreamRef.current = () => {
    const now = Date.now();
    if (
      now - lastStreamRecoveryAtRef.current <
      STREAM_RECOVERY_MIN_INTERVAL_MS
    ) {
      return;
    }

    if (status === "error") {
      lastStreamRecoveryAtRef.current = now;
      retryChatStream({ auto: true });
      return;
    }

    // Only run "silent stream" recovery while still in submitted state.
    // During active streaming, reconnecting can replay recent chunks and cause
    // visible jank even when the connection is healthy.
    if (status !== "submitted" || hasAssistantRenderableContent) {
      return;
    }

    const startedAt = inFlightStartedAtRef.current;
    if (startedAt === null || now - startedAt < STREAM_RECOVERY_STALL_MS) {
      return;
    }
    if (streamRecoveryProbeInFlightRef.current) {
      return;
    }

    streamRecoveryProbeInFlightRef.current = true;
    lastStreamRecoveryAtRef.current = now;

    void (async () => {
      try {
        const response = await fetch(`/api/sessions/${session.id}/chats`, {
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }

        const payload: unknown = await response.json();
        if (!isChatStreamingProbeResponse(payload)) {
          return;
        }

        const serverChat = payload.chats.find(
          (chat) => chat.id === chatInfo.id,
        );
        if (!serverChat?.isStreaming) {
          return;
        }

        retryChatStream({ auto: true, strategy: "soft" });
      } catch {
        // Ignore transient probe failures and try again on next interval.
      } finally {
        streamRecoveryProbeInFlightRef.current = false;
      }
    })();
  };

  // Stable identity wrapper – safe to use in effect dependency arrays without
  // causing teardown/re-register cycles.
  const maybeRecoverStream = useCallback(() => {
    maybeRecoverStreamRef.current();
  }, []);

  useEffect(() => {
    if (isChatInFlight) {
      if (inFlightStartedAtRef.current === null) {
        inFlightStartedAtRef.current = Date.now();
      }
      return;
    }

    inFlightStartedAtRef.current = null;
  }, [isChatInFlight, chatInfo.id]);

  // Recover from transient connection drops when the tab regains visibility
  // or the network comes back. The listeners are registered once because
  // maybeRecoverStream has a stable identity (delegates to a ref internally).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        maybeRecoverStream();
      }
    };

    const onFocus = () => {
      maybeRecoverStream();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", maybeRecoverStream);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", maybeRecoverStream);
    };
  }, [maybeRecoverStream]);

  useEffect(() => {
    if (!isChatInFlight || hasAssistantRenderableContent) {
      return;
    }
    if (
      typeof document !== "undefined" &&
      document.visibilityState !== "visible"
    ) {
      return;
    }

    const startedAt = inFlightStartedAtRef.current;
    const elapsed = startedAt === null ? 0 : Date.now() - startedAt;
    const waitMs = Math.max(0, STREAM_RECOVERY_STALL_MS - elapsed);
    const timeout = setTimeout(() => {
      maybeRecoverStream();
    }, waitMs);

    return () => clearTimeout(timeout);
  }, [isChatInFlight, hasAssistantRenderableContent, maybeRecoverStream]);

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

  const handleSlashCommandSelect = (
    skillName: string,
    slashStart: number,
    cursorPos: number,
  ) => {
    const before = input.slice(0, slashStart);
    const after = input.slice(cursorPos);
    const newInput = `${before}/${skillName} ${after}`;
    setInput(newInput);
    const newCursorPos = slashStart + skillName.length + 2; // / + name + space
    setCursorPosition(newCursorPos);
    setTimeout(() => {
      if (inputRef.current && inputRef.current.value === newInput) {
        inputRef.current.focus();
        inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  };

  const {
    showSlashCommands,
    slashSuggestions,
    selectedSlashIndex,
    handleSlashKeyDown,
    slashInfo,
  } = useSlashCommands({
    inputValue: input,
    cursorPosition,
    skills,
    onSelect: handleSlashCommandSelect,
  });

  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [deleteMessageError, setDeleteMessageError] = useState<string | null>(
    null,
  );
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(
    null,
  );
  const [resendingMessageId, setResendingMessageId] = useState<string | null>(
    null,
  );

  const hasMessageActionInFlight =
    deletingMessageId !== null || resendingMessageId !== null || isChatInFlight;

  const handleDeleteUserMessage = useCallback(
    async (messageId: string) => {
      if (hasMessageActionInFlight) {
        return;
      }

      const targetMessageIndex = messages.findIndex(
        (message) => message.id === messageId,
      );
      if (
        targetMessageIndex < 0 ||
        messages[targetMessageIndex]?.role !== "user"
      ) {
        return;
      }

      const confirmed = window.confirm(
        "Delete this message and all following messages?",
      );
      if (!confirmed) {
        return;
      }

      setDeleteMessageError(null);
      setDeletingMessageId(messageId);

      try {
        const response = await fetch(
          `/api/sessions/${session.id}/chats/${chatInfo.id}/messages/${messageId}`,
          { method: "DELETE" },
        );
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          success?: boolean;
        };

        if (!response.ok || !payload.success) {
          throw new Error(payload.error ?? "Failed to delete message");
        }

        setMessages(messages.slice(0, targetMessageIndex));
        await refreshChats();
      } catch (err) {
        console.error("Failed to delete message:", err);
        setDeleteMessageError(
          err instanceof Error ? err.message : "Failed to delete message",
        );
      } finally {
        setDeletingMessageId(null);
      }
    },
    [
      hasMessageActionInFlight,
      messages,
      session.id,
      chatInfo.id,
      setMessages,
      refreshChats,
    ],
  );

  const handleResendUserMessage = useCallback(
    async (messageId: string) => {
      if (hasMessageActionInFlight) {
        return;
      }

      const targetMessageIndex = messages.findIndex(
        (message) => message.id === messageId,
      );
      const targetMessage = messages[targetMessageIndex];
      if (!targetMessage || targetMessage.role !== "user") {
        return;
      }

      const resendText = targetMessage.parts
        .filter(
          (part): part is { type: "text"; text: string } =>
            part.type === "text",
        )
        .map((part) => part.text)
        .join("");
      const resendFiles = targetMessage.parts
        .filter((part): part is FileUIPart => part.type === "file")
        .map((part) => ({
          type: "file" as const,
          mediaType: part.mediaType,
          url: part.url,
          ...(part.filename ? { filename: part.filename } : {}),
        }));

      if (!resendText.trim() && resendFiles.length === 0) {
        return;
      }

      const confirmed = window.confirm(
        "Resend this message? This will delete this message and everything after it.",
      );
      if (!confirmed) {
        return;
      }

      setDeleteMessageError(null);
      setResendingMessageId(messageId);

      try {
        const response = await fetch(
          `/api/sessions/${session.id}/chats/${chatInfo.id}/messages/${messageId}`,
          { method: "DELETE" },
        );
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          success?: boolean;
        };

        if (!response.ok || !payload.success) {
          throw new Error(payload.error ?? "Failed to resend message");
        }

        setMessages(messages.slice(0, targetMessageIndex));
        setHasPendingResponse(true);
        hasSeenAssistantRenderableContentRef.current = false;
        void setChatStreaming(chatInfo.id, true);

        try {
          await sendMessage({
            text: resendText,
            files: resendFiles.length > 0 ? resendFiles : undefined,
          });
        } catch (err) {
          setHasPendingResponse(false);
          void setChatStreaming(chatInfo.id, false);
          throw err;
        }

        await refreshChats();
      } catch (err) {
        console.error("Failed to resend message:", err);
        setDeleteMessageError(
          err instanceof Error ? err.message : "Failed to resend message",
        );
      } finally {
        setResendingMessageId(null);
      }
    },
    [
      hasMessageActionInFlight,
      messages,
      session.id,
      chatInfo.id,
      setMessages,
      setChatStreaming,
      sendMessage,
      refreshChats,
    ],
  );

  const waitForSandboxReady = useCallback(
    async (maxAttempts = 8): Promise<boolean> => {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const result = await attemptReconnection();
        if (result === "connected") {
          return true;
        }

        // Keep lifecycle timing fresh during restore retries, but do not treat
        // DB-only "active" as fully ready until reconnect confirms connectivity.
        await syncSandboxStatus();
        if (attempt < maxAttempts) {
          await sleep(attempt * 350);
        }
      }
      return false;
    },
    [attemptReconnection, syncSandboxStatus],
  );

  const handleRestoreSnapshot = useCallback(async () => {
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

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        success?: boolean;
        alreadyRunning?: boolean;
      };

      if (!response.ok) {
        const errorMsg = payload.error ?? "Unknown error";

        // If a sandbox is already running (for example after a lifecycle
        // restore), reconnect instead of surfacing a blocking error.
        if (errorMsg.includes("sandbox is still running")) {
          const reconnected = await waitForSandboxReady();
          if (!reconnected) {
            setRestoreError(
              "Sandbox is already running. Refresh in a few seconds if it does not reconnect automatically.",
            );
          }
          return;
        }

        setRestoreError(`Snapshot restore failed: ${errorMsg}`);
        return;
      }

      if (payload.alreadyRunning) {
        const reconnected = await waitForSandboxReady();
        if (!reconnected) {
          setRestoreError(
            "Sandbox is already running. Refresh in a few seconds if it does not reconnect automatically.",
          );
        } else {
          void requestStatusSync("force");
        }
        return;
      }

      // Set sandbox info for the restored sandbox
      setSandboxInfo({
        createdAt: Date.now(),
        timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
      });

      // Keep preferred sandbox mode aligned with the preserved session state.
      setSandboxTypeFromUnknown(session.sandboxState?.type);

      // Refresh local timeout/connection data from server state.
      const reconnected = await waitForSandboxReady();
      if (!reconnected) {
        setRestoreError(
          "Snapshot restored, but reconnect did not complete yet. Try Resume sandbox again.",
        );
      } else {
        void requestStatusSync("force");
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setRestoreError(`Failed to restore snapshot: ${errorMsg}`);
    } finally {
      setIsRestoringSnapshot(false);
    }
  }, [
    session.id,
    session.sandboxState,
    setSandboxInfo,
    setSandboxTypeFromUnknown,
    requestStatusSync,
    waitForSandboxReady,
  ]);

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
        preferredSandboxType,
      );
      setSandboxInfo(newSandbox);
      setSandboxTypeFromUnknown(newSandbox.type);
      void requestStatusSync("force");
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
    preferredSandboxType,
    setSandboxInfo,
    setSandboxTypeFromUnknown,
    requestStatusSync,
  ]);

  useEffect(() => {
    if (isAtBottom) {
      scrollToBottom();
    }
  }, [messages, isAtBottom, scrollToBottom]);

  useEffect(() => {
    if (!isChatInFlight) {
      inputRef.current?.focus();
    }
  }, [isChatInFlight]);

  // After a chat turn completes, immediately sync status from the server.
  // If the sandbox was hibernated during the turn (tool calls failed), this
  // updates the UI right away instead of waiting for the next 15s poll.
  // Initialize to null (not `status`) so the first render always reconciles.
  // When navigating back to a chat whose stream finished in the background,
  // status is already "ready" but the optimistic streaming overlay may still
  // be set.  Starting from null makes `becameReady` true on mount, which
  // clears the stale overlay immediately.
  const prevStatusRef = useRef<string | null>(null);
  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    const wasStreaming = prevStatus === "streaming";
    const wasSubmitted = prevStatus === "submitted";
    const becameReady = status === "ready" && prevStatus !== "ready";
    const becameError = status === "error" && prevStatus !== "error";
    const shouldClearStreaming = status === "error" || becameReady;
    prevStatusRef.current = status;
    // Skip clearing the streaming overlay during unmount. When the user
    // switches to another chat, the cleanup effect calls chatInstance.stop()
    // which triggers an AbortError -> status "ready" transition. If that
    // status change propagates before React finishes tearing down the
    // component tree, this effect would clear the optimistic streaming
    // overlay even though the server-side stream is still running. The
    // SWR polling and overlay reconciliation will clear it once the server
    // confirms the stream has actually ended.
    if (shouldClearStreaming && isMountedRef.current) {
      void setChatStreaming(chatInfo.id, false);
    }
    if (becameError && pendingOptimisticTitleChatIdRef.current) {
      void clearChatTitle(pendingOptimisticTitleChatIdRef.current);
      pendingOptimisticTitleChatIdRef.current = null;
      hasSetOptimisticTitleRef.current = false;
    }
    if (becameReady) {
      pendingOptimisticTitleChatIdRef.current = null;
    }
    if (
      (wasStreaming || wasSubmitted) &&
      status === "ready" &&
      isMountedRef.current
    ) {
      void requestStatusSync("force");
      void refreshGitStatus().catch(() => {});
      void requestMarkChatRead("force");
      void refreshChats();
      // After a message completes, check branch and detect existing PRs
      void checkBranchAndPr();
    }
  }, [
    status,
    chatInfo.id,
    setChatStreaming,
    clearChatTitle,
    requestStatusSync,
    refreshGitStatus,
    requestMarkChatRead,
    refreshChats,
    checkBranchAndPr,
    router,
  ]);

  // Track whether we've auto-attempted sandbox startup for this page load.
  const hasAutoStartedSandboxRef = useRef(false);
  const hasAutoRestoredSnapshotRef = useRef(false);
  const shouldAutoResumeOnEntryRef = useRef(true);

  const isArchived = session.status === "archived";

  // Attempt a single reconnect probe on entry to pick up authoritative server state
  // (connected sandbox, no sandbox, and snapshot availability).
  // Skip for archived sessions -- they should never spin up a sandbox.
  useEffect(() => {
    if (isArchived) return;
    if (
      !sandboxInfo &&
      !isCreatingSandbox &&
      !isRestoringSnapshot &&
      reconnectionStatus === "idle"
    ) {
      void attemptReconnection();
    }
  }, [
    isArchived,
    sandboxInfo,
    isCreatingSandbox,
    isRestoringSnapshot,
    reconnectionStatus,
    attemptReconnection,
  ]);

  // Auto-resume is only for entering an already-paused session.
  // Once this tab has had an active connection, do not auto-resume again.
  useEffect(() => {
    if (sandboxInfo || reconnectionStatus === "connected") {
      shouldAutoResumeOnEntryRef.current = false;
    }
  }, [sandboxInfo, reconnectionStatus]);

  // Auto-resume paused sessions on entry once we know there is no active runtime sandbox.
  // Skip for archived sessions.
  useEffect(() => {
    if (isArchived) return;
    if (!hasSnapshot) {
      hasAutoRestoredSnapshotRef.current = false;
      return;
    }
    if (!shouldAutoResumeOnEntryRef.current) return;
    if (sandboxInfo || isCreatingSandbox || isRestoringSnapshot) return;
    if (reconnectionStatus === "checking") return;
    if (hasRuntimeSandboxState && reconnectionStatus !== "no_sandbox") return;
    if (hasAutoRestoredSnapshotRef.current) return;

    hasAutoRestoredSnapshotRef.current = true;
    shouldAutoResumeOnEntryRef.current = false;
    void handleRestoreSnapshot();
  }, [
    isArchived,
    session.id,
    hasSnapshot,
    sandboxInfo,
    isCreatingSandbox,
    isRestoringSnapshot,
    hasRuntimeSandboxState,
    reconnectionStatus,
    handleRestoreSnapshot,
  ]);

  // Server-authoritative lifecycle state: lightweight status poll every 15s.
  useEffect(() => {
    if (isCreatingSandbox || isRestoringSnapshot) return;

    const poll = () => {
      if (reconnectionStatus === "checking") return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }
      void requestStatusSync("normal");
    };

    poll();
    const interval = setInterval(poll, 15_000);
    return () => clearInterval(interval);
  }, [
    isCreatingSandbox,
    isRestoringSnapshot,
    reconnectionStatus,
    requestStatusSync,
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
        preferredSandboxType,
      );
      setSandboxInfo(newSandbox);
      setSandboxTypeFromUnknown(newSandbox.type);
      void requestStatusSync("force");
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
    preferredSandboxType,
    setSandboxInfo,
    setSandboxTypeFromUnknown,
    requestStatusSync,
  ]);

  // Auto-create sandbox right away for new sessions/chats.
  // Skip for archived sessions.
  useEffect(() => {
    if (isArchived) return;
    if (sandboxInfo || isCreatingSandbox || isRestoringSnapshot) return;

    // If we have stored sandbox state, wait for reconnect attempt first.
    if (session.sandboxState && reconnectionStatus === "idle") return;
    if (session.sandboxState && reconnectionStatus === "checking") return;
    if (session.sandboxState && reconnectionStatus === "connected") {
      hasAutoStartedSandboxRef.current = true;
      return;
    }

    // Snapshotted sessions are resumed by the auto-restore-on-entry effect.
    if (hasSnapshot) {
      return;
    }

    if (hasAutoStartedSandboxRef.current) return;
    hasAutoStartedSandboxRef.current = true;

    void ensureSandboxReady();
  }, [
    isArchived,
    session.sandboxState,
    hasSnapshot,
    reconnectionStatus,
    sandboxInfo,
    isCreatingSandbox,
    isRestoringSnapshot,
    ensureSandboxReady,
  ]);

  // Track tool completions to trigger diff refresh
  const prevToolStatesRef = useRef<Map<string, string>>(new Map());
  const hasInitializedToolStatesRef = useRef(false);

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
      // Refresh diff and files when files change.
      // Fire-and-forget with error handling - SWR updates error state internally,
      // but we catch here to prevent unhandled rejection warnings.
      refreshDiff().catch(() => {});
      refreshGitStatus().catch(() => {});
      refreshFiles().catch(() => {});
    }
  }, [
    currentToolStates,
    messages,
    refreshDiff,
    refreshGitStatus,
    refreshFiles,
  ]);

  // Note: SWR handles automatic fetching when sandbox becomes available
  // and caching/deduplication of requests

  // Get token usage from the most recent assistant message (current context usage)
  const tokenUsage = useMemo(() => {
    // Find the last assistant message with usage metadata
    for (let i = renderMessages.length - 1; i >= 0; i--) {
      const message = renderMessages[i];
      if (message?.role === "assistant" && message.metadata?.lastStepUsage) {
        return {
          inputTokens: message.metadata.lastStepUsage.inputTokens ?? 0,
          outputTokens: message.metadata.lastStepUsage.outputTokens ?? 0,
        };
      }
    }
    return { inputTokens: 0, outputTokens: 0 };
  }, [renderMessages]);

  // Detect pending AskUserQuestion tool calls
  const { hasPendingQuestion, pendingQuestionPart, questionToolCallId } =
    useMemo(() => {
      const lastMessage = renderMessages[renderMessages.length - 1];
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
    }, [renderMessages]);

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

  const isReconnectingSandbox =
    reconnectionStatus === "checking" &&
    !sandboxInfo &&
    !isCreatingSandbox &&
    !isRestoringSnapshot;
  const isHibernatingTransition =
    isReconnectingSandbox && hasSnapshot && !hasRuntimeSandboxState;
  const isArchiveSnapshotPending =
    isArchived && !hasSnapshot && hasRuntimeSandboxState;
  const isServerHibernating = lifecycleTiming.state === "hibernating";
  const isServerRestoring = lifecycleTiming.state === "restoring";
  const isServerHibernated = lifecycleTiming.state === "hibernated";
  const isHibernatingUi = isHibernatingTransition || isServerHibernating;

  // Sandbox is active only when BOTH the local connection info is valid AND
  // the server agrees the lifecycle is active (not hibernating/hibernated/failed).
  const serverSaysActive =
    lifecycleTiming.state === null ||
    lifecycleTiming.state === "active" ||
    lifecycleTiming.state === "provisioning";
  const isSandboxActive = isSandboxValid(sandboxInfo) && serverSaysActive;

  const sandboxUiStatus = useMemo(() => {
    if (isArchived) {
      return { label: "Archived", className: "bg-muted text-muted-foreground" };
    }
    if (isCreatingSandbox) {
      return { label: "Creating", className: "bg-amber-500/15 text-amber-700" };
    }
    if (isRestoringSnapshot || isServerRestoring) {
      return {
        label: "Restoring",
        className: "bg-amber-500/15 text-amber-700",
      };
    }
    if (isHibernatingUi) {
      return {
        label: "Hibernating",
        className: "bg-amber-500/15 text-amber-700",
      };
    }
    if (isReconnectingSandbox) {
      return {
        label: "Reconnecting",
        className: "bg-amber-500/15 text-amber-700",
      };
    }
    // Server says hibernated — show Paused regardless of local sandboxInfo
    if (isServerHibernated && hasSnapshot) {
      return { label: "Paused", className: "bg-muted text-muted-foreground" };
    }
    if (isSandboxActive) {
      return {
        label: "Active",
        className: "bg-emerald-500/15 text-emerald-700",
      };
    }
    if (hasSnapshot) {
      return { label: "Paused", className: "bg-muted text-muted-foreground" };
    }
    if (reconnectionStatus === "failed") {
      return {
        label: "Connection issue",
        className: "bg-destructive/10 text-destructive",
      };
    }
    return { label: "No sandbox", className: "bg-muted text-muted-foreground" };
  }, [
    isArchived,
    isCreatingSandbox,
    isRestoringSnapshot,
    isServerRestoring,
    isHibernatingUi,
    isReconnectingSandbox,
    isServerHibernated,
    hasSnapshot,
    isSandboxActive,
    reconnectionStatus,
  ]);

  const hasRepo = Boolean(session.cloneUrl);
  const hasExistingPr = session.prNumber != null;
  const hasUncommittedGitChanges = gitStatus?.hasUncommittedChanges ?? false;
  const hasUnpushedCommits = gitStatus?.hasUnpushedCommits ?? false;
  const hasBranchDiff =
    diff != null
      ? diff.summary.totalAdditions > 0 || diff.summary.totalDeletions > 0
      : (session.linesAdded ?? 0) > 0 || (session.linesRemoved ?? 0) > 0;
  const isCreatePrBranchReady = Boolean(session?.branch);
  const canCreatePr =
    hasRepo && !hasExistingPr && !hasUncommittedGitChanges && hasBranchDiff;
  const showCommitAction =
    hasRepo &&
    (hasUncommittedGitChanges || (hasExistingPr && hasUnpushedCommits));
  const commitActionLabel = hasExistingPr ? "Commit & Push" : "Commit Changes";

  return (
    <>
      {/* Header */}
      <header className="border-b border-border px-3 py-2 lg:px-4 lg:py-3">
        <div className="relative flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 lg:gap-4">
            <SidebarTrigger className="shrink-0" />
            <div className="flex min-w-0 items-center gap-2 text-sm">
              {session.repoName ? (
                <>
                  {session.cloneUrl ? (
                    /* oxlint-disable-next-line nextjs/no-html-link-for-pages */
                    <a
                      href={`https://github.com/${session.repoOwner}/${session.repoName}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 truncate font-medium text-foreground hover:underline"
                    >
                      {session.repoName}
                      <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                    </a>
                  ) : (
                    <span className="truncate font-medium text-foreground">
                      {session.repoName}
                    </span>
                  )}
                  {(session.branch ?? sandboxInfo?.currentBranch) && (
                    <>
                      <span className="hidden text-muted-foreground/40 sm:inline">
                        /
                      </span>
                      <span className="hidden text-muted-foreground sm:inline">
                        {session.branch ?? sandboxInfo?.currentBranch}
                      </span>
                    </>
                  )}
                </>
              ) : (
                <span className="truncate text-muted-foreground">
                  {session.title}
                </span>
              )}
            </div>
            <SandboxHeaderBadge
              sandboxInfo={sandboxInfo}
              isActive={isSandboxActive}
              isCreating={isCreatingSandbox}
              isRestoring={isRestoringSnapshot}
              isReconnecting={isReconnectingSandbox}
              isHibernating={isHibernatingUi}
            />
            <span
              className={`hidden shrink-0 rounded-full px-2 py-0.5 text-xs font-medium sm:inline ${sandboxUiStatus.className}`}
            >
              {sandboxUiStatus.label}
            </span>
          </div>
          {/* Right-side actions */}
          <div className="flex items-center gap-1 xl:gap-2">
            {/* Overflow menu + primary git action */}
            <div className="flex items-center gap-1">
              {hasRepo ? (
                hasExistingPr ? (
                  showCommitAction ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="relative h-8 w-8 px-0 xl:w-auto xl:px-3"
                      onClick={() => setCommitDialogOpen(true)}
                    >
                      <GitCommit className="h-4 w-4 xl:mr-2" />
                      <span className="hidden xl:inline">
                        {commitActionLabel}
                      </span>
                      {hasUncommittedGitChanges && (
                        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-orange-500" />
                      )}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 px-0 xl:w-auto xl:px-3"
                      onClick={() => {
                        const prUrl = `https://github.com/${session.repoOwner}/${session.repoName}/pull/${session.prNumber}`;
                        window.open(prUrl, "_blank", "noopener,noreferrer");
                      }}
                    >
                      <GitPullRequest className="h-4 w-4 xl:mr-2" />
                      <span className="hidden xl:inline">
                        View PR #{session.prNumber}
                      </span>
                    </Button>
                  )
                ) : showCommitAction ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="relative h-8 w-8 px-0 xl:w-auto xl:px-3"
                    onClick={() => setCommitDialogOpen(true)}
                  >
                    <GitCommit className="h-4 w-4 xl:mr-2" />
                    <span className="hidden xl:inline">
                      {commitActionLabel}
                    </span>
                    {hasUncommittedGitChanges && (
                      <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-orange-500" />
                    )}
                  </Button>
                ) : canCreatePr && isCreatePrBranchReady ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 px-0 xl:w-auto xl:px-3"
                    onClick={() => setPrDialogOpen(true)}
                  >
                    <GitPullRequest className="h-4 w-4 xl:mr-2" />
                    <span className="hidden xl:inline">Create PR</span>
                  </Button>
                ) : supportsDiff ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="relative h-8 w-8 px-0 xl:w-auto xl:px-3"
                    onClick={() => setShowDiffPanel(!showDiffPanel)}
                    disabled={!diff && !session.cachedDiff}
                  >
                    <GitCompare className="h-4 w-4 xl:mr-2" />
                    <span className="hidden xl:inline">Diff</span>
                    {hasUncommittedGitChanges && (
                      <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-orange-500" />
                    )}
                  </Button>
                ) : null
              ) : supportsRepoCreation ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 px-0 xl:w-auto xl:px-3"
                  onClick={() => setRepoDialogOpen(true)}
                >
                  <FolderGit2 className="h-4 w-4 xl:mr-2" />
                  <span className="hidden xl:inline">Create Repo</span>
                </Button>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <EllipsisVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem
                    onClick={() => setMobileChatDrawerOpen(true)}
                  >
                    <MessageSquareMore className="mr-2 h-4 w-4" />
                    Switch Chat
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setMobileShareOpen(true)}>
                    <Share2 className="mr-2 h-4 w-4" />
                    Share
                  </DropdownMenuItem>
                  {isArchived ? (
                    <DropdownMenuItem
                      disabled={isUnarchiving || isArchiveSnapshotPending}
                      onClick={() => {
                        setIsUnarchiving(true);
                        void unarchiveSession()
                          .catch((error: unknown) => {
                            console.error(
                              "Failed to unarchive session:",
                              error,
                            );
                          })
                          .finally(() => {
                            setIsUnarchiving(false);
                          });
                      }}
                    >
                      <ArchiveRestore className="mr-2 h-4 w-4" />
                      {isUnarchiving
                        ? "Unarchiving..."
                        : isArchiveSnapshotPending
                          ? "Snapshotting..."
                          : "Unarchive"}
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onClick={() => setMobileArchiveDialogOpen(true)}
                    >
                      <Archive className="mr-2 h-4 w-4" />
                      Archive
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  {supportsDiff && (
                    <DropdownMenuItem
                      disabled={!diff && !session.cachedDiff}
                      onClick={() => setShowDiffPanel(!showDiffPanel)}
                    >
                      <GitCompare className="mr-2 h-4 w-4" />
                      Diff
                      {diff &&
                        (diff.summary.totalAdditions > 0 ||
                          diff.summary.totalDeletions > 0) && (
                          <span className="ml-auto text-xs">
                            <span className="text-green-500">
                              +{diff.summary.totalAdditions}
                            </span>{" "}
                            <span className="text-red-400">
                              -{diff.summary.totalDeletions}
                            </span>
                          </span>
                        )}
                    </DropdownMenuItem>
                  )}
                  {hasRepo ? (
                    hasExistingPr ? (
                      showCommitAction ? (
                        <DropdownMenuItem
                          onClick={() => setCommitDialogOpen(true)}
                        >
                          <GitCommit className="mr-2 h-4 w-4" />
                          {commitActionLabel}
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          onClick={() => {
                            const prUrl = `https://github.com/${session.repoOwner}/${session.repoName}/pull/${session.prNumber}`;
                            window.open(prUrl, "_blank", "noopener,noreferrer");
                          }}
                        >
                          <GitPullRequest className="mr-2 h-4 w-4" />
                          View PR #{session.prNumber}
                        </DropdownMenuItem>
                      )
                    ) : (
                      <>
                        {showCommitAction && (
                          <DropdownMenuItem
                            onClick={() => setCommitDialogOpen(true)}
                          >
                            <GitCommit className="mr-2 h-4 w-4" />
                            {commitActionLabel}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          disabled={!canCreatePr || !isCreatePrBranchReady}
                          onClick={() => setPrDialogOpen(true)}
                        >
                          <GitPullRequest className="mr-2 h-4 w-4" />
                          Create PR
                        </DropdownMenuItem>
                      </>
                    )
                  ) : supportsRepoCreation ? (
                    <DropdownMenuItem onClick={() => setRepoDialogOpen(true)}>
                      <FolderGit2 className="mr-2 h-4 w-4" />
                      Create Repo
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Mobile chat switcher drawer */}
            <Drawer
              open={mobileChatDrawerOpen}
              onOpenChange={setMobileChatDrawerOpen}
            >
              <DrawerContent>
                <DrawerHeader>
                  <DrawerTitle>Switch Chat</DrawerTitle>
                </DrawerHeader>
                <div className="max-h-[60vh] overflow-y-auto px-2 pb-4">
                  <div className="space-y-0.5">
                    {mobileChats.map((chat) => (
                      <button
                        key={chat.id}
                        type="button"
                        onClick={() => {
                          mobileSwitchChat(chat.id);
                          setMobileChatDrawerOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition-colors",
                          chat.id === mobileActiveChatId
                            ? "bg-secondary"
                            : "hover:bg-muted/50",
                        )}
                      >
                        <span className="truncate text-sm font-medium">
                          {chat.title || "Untitled"}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {chat.isStreaming && (
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                          )}
                          {chat.id === mobileActiveChatId && (
                            <Check className="h-3.5 w-3.5 text-foreground" />
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 border-t border-border pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        handleMobileNewChat();
                        setMobileChatDrawerOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      New chat
                    </button>
                  </div>
                </div>
              </DrawerContent>
            </Drawer>

            {/* Mobile share dialog */}
            <ShareDialog
              sessionId={session.id}
              initialShareId={session.shareId}
              externalOpen={mobileShareOpen}
              onExternalOpenChange={setMobileShareOpen}
            />

            {/* Mobile archive confirmation dialog */}
            <Dialog
              open={mobileArchiveDialogOpen}
              onOpenChange={setMobileArchiveDialogOpen}
            >
              <DialogContent showCloseButton={false}>
                <DialogHeader>
                  <DialogTitle>Archive session?</DialogTitle>
                  <DialogDescription>
                    This will stop the sandbox and archive the session. You can
                    still view it in the archive tab.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">Cancel</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button
                      onClick={() => {
                        void archiveSession().catch((error: unknown) => {
                          console.error("Failed to archive session:", error);
                        });
                        router.push("/sessions");
                      }}
                    >
                      Archive
                    </Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </header>

      {/* Transient error banner (e.g. iOS "Load failed" after sleep) */}
      {error && (
        <div className="flex items-center justify-between gap-3 border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <p className="min-w-0 truncate">{error.message}</p>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10"
            onClick={() => retryChatStream()}
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </Button>
        </div>
      )}

      {/* Messages */}
      <div className="relative flex-1 overflow-hidden">
        <div ref={containerRef} className="h-full overflow-y-auto">
          <div className="mx-auto max-w-4xl overflow-hidden px-4 py-8">
            <div className="space-y-6">
              {groupedRenderMessages.map(
                ({ message: m, groups, isStreaming: isMessageStreaming }) => {
                  return groups.map((group) => {
                    if (group.type === "task-group") {
                      return (
                        <div
                          key={`${m.id}-${group.renderKey}`}
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

                    if (isReasoningUIPart(p)) {
                      return (
                        <div
                          key={`${m.id}-${group.renderKey}`}
                          className="flex justify-start"
                        >
                          <ThinkingBlock
                            text={p.text}
                            isStreaming={
                              isMessageStreaming && p.state === "streaming"
                            }
                          />
                        </div>
                      );
                    }

                    if (p.type === "text") {
                      return (
                        <div
                          key={`${m.id}-${group.renderKey}`}
                          className={cn(
                            "flex min-w-0",
                            m.role === "user" ? "justify-end" : "justify-start",
                          )}
                        >
                          {m.role === "user" ? (
                            <div className="group relative w-fit min-w-0 max-w-[80%]">
                              <div className="rounded-3xl bg-secondary px-4 py-2">
                                <p className="whitespace-pre-wrap break-words">
                                  {p.text}
                                </p>
                              </div>
                              {group.index === 0 && (
                                <div className="absolute -left-20 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-md bg-background/80 p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleResendUserMessage(m.id)
                                    }
                                    disabled={hasMessageActionInFlight}
                                    aria-label="Resend this message and delete everything after it"
                                    className="rounded p-1 transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    {resendingMessageId === m.id ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <RotateCcw className="h-4 w-4" />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleDeleteUserMessage(m.id)
                                    }
                                    disabled={hasMessageActionInFlight}
                                    aria-label="Delete this message and everything after it"
                                    className="rounded p-1 transition hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    {deletingMessageId === m.id ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-4 w-4" />
                                    )}
                                  </button>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="min-w-0 w-full overflow-hidden">
                              <Streamdown
                                animated={
                                  isMessageStreaming
                                    ? {
                                        animation: "fadeIn",
                                        duration: 250,
                                        easing: "ease-out",
                                      }
                                    : undefined
                                }
                                mode={
                                  isMessageStreaming ? "streaming" : "static"
                                }
                                isAnimating={isMessageStreaming}
                                plugins={streamdownPlugins}
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
                        <div
                          key={`${m.id}-${group.renderKey}`}
                          className="max-w-full"
                        >
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
                        <div
                          key={`${m.id}-${group.renderKey}`}
                          className="flex justify-end"
                        >
                          <div className="group relative w-fit max-w-[80%]">
                            {/* eslint-disable-next-line @next/next/no-img-element -- Data URLs not supported by next/image */}
                            <img
                              src={p.url}
                              alt={p.filename ?? "Attached image"}
                              className="max-h-64 rounded-lg"
                            />
                            {m.role === "user" && group.index === 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  void handleDeleteUserMessage(m.id)
                                }
                                disabled={hasMessageActionInFlight}
                                aria-label="Delete this message and everything after it"
                                className="absolute -left-10 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                {deletingMessageId === m.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    }

                    return null;
                  });
                },
              )}
              {showThinkingIndicator && (
                <div className="flex justify-start">
                  <ThinkingBlock text="" isStreaming />
                </div>
              )}
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
      <div className="p-4 pb-2 sm:pb-8">
        <div className="mx-auto max-w-4xl space-y-2">
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
          {deleteMessageError && (
            <div className="flex items-center justify-between rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <span>{deleteMessageError}</span>
              <button
                type="button"
                onClick={() => setDeleteMessageError(null)}
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
            {showSlashCommands && !showSuggestions && (
              <SlashCommandDropdown
                suggestions={slashSuggestions}
                selectedIndex={selectedSlashIndex}
                onSelect={(suggestion) => {
                  if (slashInfo) {
                    handleSlashCommandSelect(
                      suggestion.name,
                      slashInfo.slashStart,
                      cursorPosition,
                    );
                  }
                }}
                isLoading={skillsLoading}
              />
            )}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (isArchived || !isSandboxActive) return;
                const hasContent = input.trim() || images.length > 0;
                if (!hasContent) return;

                const messageText = input;
                const files = getFileParts();
                setInput("");
                clearImages();

                const shouldSetOptimisticTitle =
                  !hadInitialMessages && !hasSetOptimisticTitleRef.current;
                const trimmedText = messageText.trim();
                if (shouldSetOptimisticTitle && trimmedText.length > 0) {
                  const nextTitle =
                    trimmedText.length > 30
                      ? `${trimmedText.slice(0, 30)}...`
                      : trimmedText;
                  hasSetOptimisticTitleRef.current = true;
                  pendingOptimisticTitleChatIdRef.current = chatInfo.id;
                  void setChatTitle(chatInfo.id, nextTitle);
                }
                setHasPendingResponse(true);
                hasSeenAssistantRenderableContentRef.current = false;
                void setChatStreaming(chatInfo.id, true);
                try {
                  await sendMessage({ text: messageText, files });
                } catch (err) {
                  if (pendingOptimisticTitleChatIdRef.current) {
                    void clearChatTitle(
                      pendingOptimisticTitleChatIdRef.current,
                    );
                    pendingOptimisticTitleChatIdRef.current = null;
                    hasSetOptimisticTitleRef.current = false;
                  }
                  setHasPendingResponse(false);
                  void setChatStreaming(chatInfo.id, false);
                  console.error("Failed to send message:", err);
                }
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
                isSandboxActive={isSandboxActive}
                isCreating={isCreatingSandbox}
                isRestoring={isRestoringSnapshot}
                isReconnecting={isReconnectingSandbox && !isHibernatingUi}
                isHibernating={isHibernatingUi}
                isArchived={isArchived}
                isInitializing={reconnectionStatus === "idle"}
                snapshotPending={isArchiveSnapshotPending}
                hasSnapshot={hasSnapshot}
                onRestore={handleRestoreSnapshot}
                onCreateNew={handleCreateNewSandbox}
              />

              {/* Image attachments preview */}
              <ImageAttachmentsPreview images={images} onRemove={removeImage} />

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
                    if (handleSlashKeyDown(e)) {
                      return;
                    }
                    // Handle form submission
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (!isArchived && isSandboxActive) {
                        e.currentTarget.form?.requestSubmit();
                      }
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
                  disabled={isArchived || isChatInFlight}
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
                    disabled={isArchived}
                    className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                  >
                    <Paperclip className="h-4 w-4" />
                  </Button>
                  {renderMessages.length === 0 && chatInfo.modelId ? (
                    <div
                      className={
                        isChatInFlight || isUpdatingModel
                          ? "pointer-events-none opacity-60"
                          : undefined
                      }
                    >
                      <ModelSelectorCompact
                        value={chatInfo.modelId}
                        models={models}
                        isLoading={modelsLoading}
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
                  <ContextUsageIndicator
                    inputTokens={tokenUsage.inputTokens}
                    outputTokens={tokenUsage.outputTokens}
                    contextLimit={contextLimit ?? DEFAULT_CONTEXT_LIMIT}
                  />
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={handleMicClick}
                    disabled={isArchived || recordingState === "processing"}
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

                  {isChatInFlight || hasPendingResponse ? (
                    <Button
                      type="button"
                      size="icon"
                      onClick={() => {
                        fetch(`/api/chat/${chatInfo.id}/stop`, {
                          method: "POST",
                        }).catch(() => {});
                        stopChatStream();
                        setHasPendingResponse(false);
                      }}
                      className="h-8 w-8 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      style={{ touchAction: "manipulation" }}
                    >
                      <Square className="h-3 w-3 fill-current" />
                    </Button>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button
                            type="submit"
                            size="icon"
                            onTouchEnd={() => {
                              // On iOS, tapping submit while the textarea is focused
                              // causes the keyboard to briefly flash open then closed.
                              // Blur the textarea immediately to prevent this.
                              inputRef.current?.blur();
                            }}
                            disabled={
                              isArchived ||
                              isChatInFlight ||
                              (!input.trim() && images.length === 0) ||
                              isUpdatingModel ||
                              !isSandboxActive
                            }
                            className="h-8 w-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30"
                          >
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                        </span>
                      </TooltipTrigger>
                      {!isSandboxActive && !isArchived && (
                        <TooltipContent side="top" sideOffset={8}>
                          Waiting for sandbox...
                        </TooltipContent>
                      )}
                    </Tooltip>
                  )}
                </div>
              </div>
            </form>

            {/* Recording error message */}
            {recordingError && (
              <p className="mt-2 text-sm text-destructive">{recordingError}</p>
            )}
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
          onPrDetected={(pr) => {
            updateSessionPullRequest(pr);
          }}
        />
      )}

      {/* Commit Dialog */}
      {session && (
        <CommitDialog
          open={commitDialogOpen}
          onOpenChange={setCommitDialogOpen}
          session={session}
          hasSandbox={sandboxInfo !== null}
          gitStatus={gitStatus}
          refreshGitStatus={refreshGitStatus}
          onOpenCreatePr={() => setPrDialogOpen(true)}
          onCommitted={() => {
            refreshGitStatus().catch(() => {});
            refreshDiff().catch(() => {});
            refreshFiles().catch(() => {});
          }}
        />
      )}

      {/* Create Repo Dialog */}
      {session && (
        <CreateRepoDialog
          open={repoDialogOpen}
          onOpenChange={setRepoDialogOpen}
          session={session}
          hasSandbox={sandboxInfo !== null}
          onRepoCreated={(result) => {
            updateSessionRepo({
              cloneUrl: result.cloneUrl,
              repoOwner: result.owner,
              repoName: result.repoName,
              branch: result.branch,
            });
          }}
        />
      )}

      {/* Diff Viewer Modal */}
      <DiffViewer open={showDiffPanel} onOpenChange={setShowDiffPanel} />
    </>
  );
}
