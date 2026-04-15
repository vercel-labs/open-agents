"use client";

import type { AskUserQuestionInput } from "@open-harness/agent";
import { formatTokens } from "@open-harness/shared";
import {
  isReasoningUIPart,
  isToolUIPart,
  type FileUIPart,
  type LanguageModelUsage,
} from "ai";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  Code2,
  Copy,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Globe,
  Link2,
  Loader2,
  Mic,
  Paperclip,
  Play,
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
import { createPortal } from "react-dom";
import useSWR from "swr";
import type { ChatRefreshResponse } from "@/app/api/sessions/[sessionId]/chats/[chatId]/route";
import type { MergePullRequestResponse } from "@/app/api/sessions/[sessionId]/merge/route";
import type { PrDeploymentResponse } from "@/app/api/sessions/[sessionId]/pr-deployment/route";
import type { PullRequestCheckRun } from "@/lib/github/client";
import type {
  WebAgentCommitDataPart,
  WebAgentPrDataPart,
  WebAgentSnippetDataPart,
  WebAgentUIMessage,
  WebAgentUIMessagePart,
  WebAgentUIToolPart,
} from "@/app/types";
import {
  AssistantFileLink,
  type AssistantFileLinkProps,
} from "@/components/assistant-file-link";
import { FileSuggestionsDropdown } from "@/components/file-suggestions-dropdown";
import { ImageAttachmentsPreview } from "@/components/image-attachments-preview";
import { TextAttachmentsPreview } from "@/components/text-attachments-preview";
import { ModelSelectorCompact } from "@/components/model-selector-compact";
import { useInlineQuestion } from "@/components/inline-question-input";
import { SlashCommandDropdown } from "@/components/slash-command-dropdown";
import { SnippetChip } from "@/components/snippet-chip";
import { AssistantMessageGroups } from "@/components/assistant-message-groups";
import {
  PinnedTodoPanel,
  getLatestTodos,
} from "@/components/pinned-todo-panel";
import { ThinkingBlock } from "@/components/thinking-block";
import { ToolCall } from "@/components/tool-call";
import { OpenFileProvider } from "@/components/tool-call/open-file-context";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAudioRecording } from "@/hooks/use-audio-recording";
import { useFileSuggestions } from "@/hooks/use-file-suggestions";
import { useImageAttachments } from "@/hooks/use-image-attachments";
import { useTextAttachments } from "@/hooks/use-text-attachments";
import { useScrollToBottom } from "@/hooks/use-scroll-to-bottom";
import { useSessionChats } from "@/hooks/use-session-chats";
import { useSlashCommands } from "@/hooks/use-slash-commands";
import { useUserPreferences } from "@/hooks/use-user-preferences";
import {
  getGitFinalizationState,
  hasRenderableAssistantPart,
  isChatInFlight as isChatInFlightStatus,
  isGitDataPart,
  shouldKeepCollapsedReasoningStreaming,
  shouldRenderGitDataPart,
  shouldShowThinkingIndicator,
} from "@/lib/chat-streaming-state";
import { ACCEPT_IMAGE_TYPES, isValidImageType } from "@/lib/image-utils";
import { isLargeText } from "@/lib/text-attachment-utils";
import {
  type AvailableModelCost,
  DEFAULT_CONTEXT_LIMIT,
  estimateModelUsageCost,
} from "@/lib/models";
import { getPrDeploymentRefreshInterval } from "@/lib/pr-deployment-polling";
import { fetcher } from "@/lib/swr";
import { streamdownPlugins } from "@/lib/streamdown-config";
import { cn } from "@/lib/utils";
import {
  type SandboxInfo,
  useSessionChatMetadataContext,
  useSessionChatRuntimeContext,
  useSessionChatWorkspaceContext,
} from "./session-chat-context";
import { useStreamRecovery } from "./hooks/use-stream-recovery";
import { useAutoCommitStatus } from "./hooks/use-auto-commit-status";
import { useCodeEditor } from "./hooks/use-code-editor";
import { useDevServer } from "./hooks/use-dev-server";
import { useGitPanel } from "./git-panel-context";
import {
  createSandbox,
  getSandboxCreateErrorDetails,
  type SandboxCreateErrorDetails,
} from "./sandbox-create";
import { SandboxCreateErrorBanner } from "./sandbox-create-error-banner";
import { WorkspaceFileViewer } from "./workspace-file-viewer";
import "streamdown/styles.css";

/** Minimum interval between textarea-focus activity pings (5 minutes). */
const ACTIVITY_PING_THROTTLE_MS = 5 * 60 * 1000;

const DiffViewer = dynamic(
  () => import("./diff-viewer").then((m) => m.DiffViewer),
  { ssr: false },
);

const MergePrDialog = dynamic(
  () => import("@/components/merge-pr-dialog").then((m) => m.MergePrDialog),
  { ssr: false },
);
const ClosePrDialog = dynamic(
  () => import("@/components/close-pr-dialog").then((m) => m.ClosePrDialog),
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
const DiffTabView = dynamic(
  () => import("./diff-tab-view").then((m) => m.DiffTabView),
  { ssr: false },
);
const FileTabView = dynamic(
  () => import("./file-tab-view").then((m) => m.FileTabView),
  { ssr: false },
);
const GitPanel = dynamic(() => import("./git-panel").then((m) => m.GitPanel), {
  ssr: false,
});

const emptySubscribe = () => () => {};

function useHasMounted() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

type ReasoningMessagePart = Extract<
  WebAgentUIMessagePart,
  { type: "reasoning" }
>;

type MessageRenderGroup =
  | {
      type: "part";
      part: WebAgentUIMessagePart;
      index: number;
      renderKey: string;
    }
  | {
      type: "reasoning-group";
      parts: ReasoningMessagePart[];
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

  if (isGitDataPart(part)) {
    return part.id ? `data:${part.type}:${part.id}` : `data:${part.type}`;
  }

  return `part:${part.type}`;
}

function getReasoningGroupText(parts: ReasoningMessagePart[]): string {
  return parts
    .map((part) => part.text)
    .filter((text) => text.trim().length > 0)
    .join("\n\n");
}

function GitDataPartCard({
  part,
}: {
  part: WebAgentCommitDataPart | WebAgentPrDataPart;
}) {
  const isCommit = part.type === "data-commit";
  const { status } = part.data;
  const isPending = status === "pending";
  const isSuccess = status === "success";
  const isError = status === "error";

  const url = part.data.url;

  // Commit-specific data
  const shortSha =
    isCommit && part.data.commitSha
      ? part.data.commitSha.slice(0, 7)
      : undefined;
  const commitMessage = isCommit ? part.data.commitMessage : undefined;

  // PR-specific data
  const prNumber = !isCommit ? part.data.prNumber : undefined;

  // Determine primary label
  let label: string;
  if (isCommit) {
    if (isPending) label = "Creating commit…";
    else if (isSuccess) {
      if (part.data.committed && part.data.pushed) {
        label = "Committed & pushed";
      } else if (part.data.committed) {
        label = "Committed";
      } else if (part.data.pushed) {
        label = "Pushed commits";
      } else {
        label = "Commit complete";
      }
    } else if (isError) label = part.data.error ?? "Commit failed";
    else label = "No changes to commit";
  } else {
    if (isPending) label = "Creating pull request…";
    else if (isSuccess) {
      if (part.data.requiresManualCreation) {
        label = "Ready to create on GitHub";
      } else if (part.data.syncedExisting && prNumber) {
        label = `Synced to existing PR #${prNumber}`;
      } else if (prNumber) {
        label = `Opened PR #${prNumber}`;
      } else {
        label = "Pull request ready";
      }
    } else if (isError) label = part.data.error ?? "PR failed";
    else label = part.data.skipReason ?? "PR skipped";
  }

  // Build the detail fragment shown after the dot separator
  const detail = isCommit ? (shortSha ?? commitMessage) : undefined;

  // The icon shown inline in the separator
  const IconEl = isPending ? (
    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/50" />
  ) : isError ? (
    <X className="h-3 w-3 text-red-500/70" />
  ) : isCommit ? (
    <GitCommitHorizontal className="h-3 w-3 text-muted-foreground/50" />
  ) : (
    <GitPullRequest className="h-3 w-3 text-muted-foreground/50" />
  );

  // For commits with both a SHA and a message, show the message beneath
  const subtitle =
    isCommit && shortSha && commitMessage ? commitMessage : undefined;

  const textColor = isError
    ? "text-red-500/70 dark:text-red-400/70"
    : "text-muted-foreground/70";

  const Wrapper = url && !isPending ? "a" : "div";
  const wrapperProps =
    url && !isPending
      ? ({
          href: url,
          target: "_blank",
          rel: "noreferrer",
        } as const)
      : {};

  return (
    <div className="flex items-center gap-3 py-1">
      {/* Left rule */}
      <div className="h-px flex-1 bg-border/60" />

      {/* Center label */}
      <Wrapper
        {...wrapperProps}
        className={cn(
          "group/sep flex max-w-[80%] items-center gap-1.5",
          url && !isPending && "cursor-pointer",
        )}
      >
        {IconEl}
        <span
          className={cn(
            "truncate text-xs font-medium",
            textColor,
            url &&
              !isPending &&
              "group-hover/sep:text-foreground transition-colors",
          )}
        >
          {label}
        </span>
        {detail && (
          <>
            <span className="text-muted-foreground/30">·</span>
            <span
              className={cn(
                "truncate font-mono text-[11px]",
                textColor,
                url &&
                  !isPending &&
                  "group-hover/sep:text-foreground transition-colors",
              )}
            >
              {detail}
            </span>
          </>
        )}
        {url && !isPending && (
          <ExternalLink
            className={cn(
              "h-3 w-3 shrink-0 text-muted-foreground/0 transition-colors",
              "group-hover/sep:text-muted-foreground",
            )}
          />
        )}
      </Wrapper>

      {/* Right rule */}
      <div className="h-px flex-1 bg-border/60" />

      {/* Subtitle (commit message when SHA is shown as detail) */}
      {subtitle && <p className="sr-only">{subtitle}</p>}
    </div>
  );
}

function isSandboxValid(sandboxInfo: SandboxInfo | null): boolean {
  if (!sandboxInfo) return false;
  if (sandboxInfo.timeout === null) return true; // No timeout = always valid
  const expiresAt = sandboxInfo.createdAt + sandboxInfo.timeout;
  return Date.now() < expiresAt;
}

function formatUsd(amount: number): string {
  if (amount >= 100) {
    return "$" + amount.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
  if (amount >= 1) {
    return (
      "$" +
      amount.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }
  if (amount >= 0.01) {
    return (
      "$" +
      amount.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }
  return (
    "$" +
    amount.toLocaleString("en-US", {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    })
  );
}

type MessageUsageTotals = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

function getCachedInputTokens(usage: LanguageModelUsage | undefined): number {
  return (
    usage?.inputTokenDetails?.cacheReadTokens ?? usage?.cachedInputTokens ?? 0
  );
}

function getUsageTotals(
  usage: LanguageModelUsage | undefined,
): MessageUsageTotals {
  return {
    inputTokens: usage?.inputTokens ?? 0,
    cachedInputTokens: getCachedInputTokens(usage),
    outputTokens: usage?.outputTokens ?? 0,
  };
}

function getLatestContextUsage(
  messages: WebAgentUIMessage[],
): MessageUsageTotals {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === "assistant" && message.metadata?.lastStepUsage) {
      return getUsageTotals(message.metadata.lastStepUsage);
    }
  }

  return getUsageTotals(undefined);
}

function getConversationUsage(
  messages: WebAgentUIMessage[],
): MessageUsageTotals {
  return messages.reduce<MessageUsageTotals>((total, message) => {
    if (message.role !== "assistant") {
      return total;
    }

    const usage =
      message.metadata?.totalMessageUsage ?? message.metadata?.lastStepUsage;
    if (!usage) {
      return total;
    }

    const usageTotals = getUsageTotals(usage);
    return {
      inputTokens: total.inputTokens + usageTotals.inputTokens,
      cachedInputTokens:
        total.cachedInputTokens + usageTotals.cachedInputTokens,
      outputTokens: total.outputTokens + usageTotals.outputTokens,
    };
  }, getUsageTotals(undefined));
}

function getConversationEstimatedCost(
  messages: WebAgentUIMessage[],
  modelCost: AvailableModelCost | undefined,
): number | undefined {
  let totalCost = 0;
  let hasUsage = false;

  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }

    const usage =
      message.metadata?.totalMessageUsage ?? message.metadata?.lastStepUsage;
    if (!usage) {
      continue;
    }

    const estimatedCost = estimateModelUsageCost(
      getUsageTotals(usage),
      modelCost,
    );
    if (estimatedCost === undefined) {
      return undefined;
    }

    totalCost += estimatedCost;
    hasUsage = true;
  }

  return hasUsage ? totalCost : undefined;
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
  conversationInputTokens,
  conversationCachedInputTokens,
  conversationOutputTokens,
  estimatedConversationCost,
  contextLimit,
}: {
  inputTokens: number;
  conversationInputTokens: number;
  conversationCachedInputTokens: number;
  conversationOutputTokens: number;
  estimatedConversationCost?: number;
  contextLimit: number;
}) {
  if (inputTokens === 0) {
    return null;
  }

  const percentage =
    contextLimit > 0 ? Math.round((inputTokens / contextLimit) * 100) : 0;
  const uncachedConversationInputTokens = Math.max(
    0,
    conversationInputTokens - conversationCachedInputTokens,
  );

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
            <span className="opacity-60">Conversation input</span>
            <span>{formatTokens(conversationInputTokens)}</span>
          </div>
          <div className="flex justify-between gap-6">
            <span className="opacity-60">Cached input</span>
            <span>{formatTokens(conversationCachedInputTokens)}</span>
          </div>
          <div className="flex justify-between gap-6">
            <span className="opacity-60">Uncached input</span>
            <span>{formatTokens(uncachedConversationInputTokens)}</span>
          </div>
          <div className="flex justify-between gap-6">
            <span className="opacity-60">Conversation output</span>
            <span>{formatTokens(conversationOutputTokens)}</span>
          </div>
          {estimatedConversationCost !== undefined ? (
            <div className="flex justify-between gap-6">
              <span className="opacity-60">Est. cost</span>
              <span>{formatUsd(estimatedConversationCost)}</span>
            </div>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function _SandboxHeaderBadge({
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
              ? "Sandbox pause in progress. Unarchive will be available in a few seconds."
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
  chatId,
  initialShareId,
  externalOpen,
  onExternalOpenChange,
}: {
  sessionId: string;
  chatId: string;
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

  useEffect(() => {
    let active = true;
    setShareId(initialShareId);
    setCopied(false);
    setError(null);

    const loadShareId = async () => {
      try {
        const res = await fetch(
          `/api/sessions/${sessionId}/chats/${chatId}/share`,
        );
        if (!res.ok) {
          return;
        }
        const data = (await res.json()) as { shareId: string | null };
        if (!active) {
          return;
        }
        setShareId(data.shareId);
      } catch {
        // Ignore silent refresh errors in dialog state; user action still works.
      }
    };

    void loadShareId();

    return () => {
      active = false;
    };
  }, [sessionId, chatId, initialShareId]);

  async function enableSharing() {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/chats/${chatId}/share`,
        {
          method: "POST",
        },
      );
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
      const res = await fetch(
        `/api/sessions/${sessionId}/chats/${chatId}/share`,
        {
          method: "DELETE",
        },
      );
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
          <DialogTitle>Share chat</DialogTitle>
          <DialogDescription>
            Anyone with the link can view this chat in read-only mode.
          </DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {shareId ? (
          <>
            <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-md border bg-muted px-3 py-2 text-sm">
                <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{shareUrl}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={copyLink}
                className="w-full sm:w-auto sm:shrink-0"
              >
                {copied ? (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy link
                  </>
                )}
              </Button>
            </div>
            <DialogFooter className="sm:justify-between">
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

export function SessionChatContent({
  initialIsOnlyChatInSession,
  messageDurationMap,
  messageStartedAtMap,
  lastUserMessageSentAt,
  codeEditorDisabledReason,
}: {
  initialIsOnlyChatInSession: boolean;
  /** Pre-computed generation duration (ms) per assistant message ID */
  messageDurationMap: Record<string, number>;
  /** ISO timestamp of the preceding user message's createdAt, for live timers */
  messageStartedAtMap: Record<string, string>;
  /** Fallback: last user message's createdAt, for refresh-during-stream */
  lastUserMessageSentAt: string | null;
  codeEditorDisabledReason: string | null;
}) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [isCreatingSandbox, setIsCreatingSandbox] = useState(false);
  const [isRestoringSnapshot, setIsRestoringSnapshot] = useState(false);
  const [_isUnarchiving, _setIsUnarchiving] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [repoDialogOpen, setRepoDialogOpen] = useState(false);
  const [showDiffPanel, setShowDiffPanel] = useState(false);
  const [selectedWorkspaceFile, setSelectedWorkspaceFile] = useState<
    string | null
  >(null);
  const [mobileArchiveDialogOpen, setMobileArchiveDialogOpen] = useState(false);
  const [mobileShareOpen, setMobileShareOpen] = useState(false);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [copiedAssistantMessageId, setCopiedAssistantMessageId] = useState<
    string | null
  >(null);
  const [forkingAssistantMessageId, setForkingAssistantMessageId] = useState<
    string | null
  >(null);
  const [branchPreviewUrlChangeBaseline, setBranchPreviewUrlChangeBaseline] =
    useState<string | null | undefined>(undefined);
  const hasMounted = useHasMounted();
  const {
    activeView,
    gitPanelOpen,
    shareRequested,
    setShareRequested,
    setHasActionNeeded,
    setChangesCount,
    setHasCommittedChanges,
    panelPortalRef,
    headerActionsRef,
  } = useGitPanel();
  const { preferences } = useUserPreferences();
  const isIosDevice = useMemo(() => {
    if (typeof navigator === "undefined") {
      return false;
    }

    return (
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
    );
  }, []);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isMountedRef = useRef(true);
  const copyResetTimeoutRef = useRef<number | null>(null);
  const lastActivityPingRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
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

  const handleCopyAssistantMessage = useCallback(
    async (messageId: string, text: string) => {
      const trimmedText = text.trim();
      if (trimmedText.length === 0) {
        return;
      }

      if (typeof navigator === "undefined" || !navigator.clipboard) {
        return;
      }

      try {
        await navigator.clipboard.writeText(trimmedText);
        setCopiedAssistantMessageId(messageId);
        if (copyResetTimeoutRef.current !== null) {
          window.clearTimeout(copyResetTimeoutRef.current);
        }
        copyResetTimeoutRef.current = window.setTimeout(() => {
          setCopiedAssistantMessageId((currentMessageId) =>
            currentMessageId === messageId ? null : currentMessageId,
          );
          copyResetTimeoutRef.current = null;
        }, 2000);
      } catch (copyError) {
        console.error("Failed to copy assistant message:", copyError);
      }
    },
    [],
  );

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
  const {
    textAttachments,
    addTextAttachment,
    removeTextAttachment,
    clearTextAttachments,
  } = useTextAttachments();
  const { containerRef, isAtBottom, scrollToBottom } =
    useScrollToBottom<HTMLDivElement>();
  const {
    session,
    chatInfo,
    setSandboxInfo,
    archiveSession,
    unarchiveSession: _unarchiveSession,
    updateChatModel,
    updateSessionTitle,
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
    modelOptions,
    modelOptionsLoading,
  } = useSessionChatMetadataContext();
  const {
    chat,
    contextLimit,
    stopChatStream,
    retryChatStream,
    hadInitialMessages,
    initialMessages,
  } = useSessionChatRuntimeContext();
  const {
    sandboxInfo,
    diff,
    diffRefreshing,
    refreshDiff,
    gitStatus,
    gitStatusLoading,
    refreshGitStatus,
    files,
    filesLoading,
    refreshFiles,
    skills,
    skillsLoading,
    refreshSkills,
  } = useSessionChatWorkspaceContext();

  // Ping the server to refresh the inactivity timer when the user focuses
  // the textarea. Throttled to at most once every 5 minutes so we don't
  // spam the endpoint on repeated focus/blur cycles.
  const handleTextareaFocus = useCallback(() => {
    const now = Date.now();
    if (now - lastActivityPingRef.current < ACTIVITY_PING_THROTTLE_MS) {
      return;
    }
    lastActivityPingRef.current = now;
    void fetch("/api/sandbox/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session.id }),
    }).catch(() => {
      // Fire-and-forget – don't block the UI on failures.
    });
  }, [session.id]);

  const autoCommitEnabled = Boolean(
    session.cloneUrl &&
    session.repoOwner &&
    session.repoName &&
    (session.autoCommitPushOverride ?? preferences?.autoCommitPush ?? false),
  );
  const { isAutoCommitting, markAutoCommitStarted } = useAutoCommitStatus(
    autoCommitEnabled,
    gitStatus,
    () => {
      void refreshGitStatus().catch(() => undefined);
      void refreshDiff().catch(() => undefined);
      void refreshFiles().catch(() => undefined);
      void checkBranchAndPr().catch(() => undefined);
    },
  );
  const {
    messages,
    error,
    clearError,
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
    forkChat,
  } = useSessionChats(session.id);
  const handleForkAssistantMessage = useCallback(
    async (messageId: string) => {
      if (forkingAssistantMessageId !== null) {
        return;
      }

      setForkingAssistantMessageId(messageId);
      try {
        const { persisted } = forkChat(chatInfo.id, messageId);
        const forkedChat = await persisted;
        router.push(`/sessions/${session.id}/chats/${forkedChat.id}`, {
          scroll: false,
        });
      } catch (forkError) {
        console.error("Failed to fork chat:", forkError);
      } finally {
        if (isMountedRef.current) {
          setForkingAssistantMessageId((currentMessageId) =>
            currentMessageId === messageId ? null : currentMessageId,
          );
        }
      }
    },
    [chatInfo.id, forkChat, forkingAssistantMessageId, router, session.id],
  );
  const upsertSyntheticAssistantGitMessage = useCallback(
    async (message: WebAgentUIMessage) => {
      setMessages((currentMessages) => {
        const existingIndex = currentMessages.findIndex(
          (currentMessage) => currentMessage.id === message.id,
        );

        if (existingIndex < 0) {
          return [...currentMessages, message];
        }

        const nextMessages = [...currentMessages];
        nextMessages[existingIndex] = message;
        return nextMessages;
      });

      try {
        const response = await fetch(
          `/api/sessions/${session.id}/chats/${chatInfo.id}/messages`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message }),
          },
        );

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(
            body?.error ?? "Failed to persist synthetic assistant message",
          );
        }

        await refreshChats().catch(() => undefined);
        await markChatRead(chatInfo.id).catch(() => undefined);
      } catch (error) {
        console.error(
          "Failed to persist synthetic assistant git message:",
          error,
        );
      }
    },
    [chatInfo.id, markChatRead, refreshChats, session.id, setMessages],
  );
  const renderMessages = useMemo(
    () => (hasMounted ? messages : initialMessages),
    [hasMounted, messages, initialMessages],
  );
  // Track explicit user-initiated stops so the UI can immediately reflect the
  // idle state even if the AI SDK `status` is stuck (common on iOS/Safari where
  // fetch abort doesn't cleanly settle the hook status).
  const [userStopped, setUserStopped] = useState(false);
  const isChatInFlight = isChatInFlightStatus(status) && !userStopped;
  const lastMessage = useMemo(
    () => renderMessages[renderMessages.length - 1],
    [renderMessages],
  );
  const gitFinalizationState = useMemo(
    () =>
      getGitFinalizationState({
        status,
        lastMessageRole: lastMessage?.role,
        lastMessageParts: lastMessage?.parts,
      }),
    [lastMessage, status],
  );
  const hasAssistantRenderableContent = useMemo(
    () =>
      lastMessage?.role === "assistant"
        ? lastMessage.parts.some(hasRenderableAssistantPart)
        : false,
    [lastMessage],
  );
  const hasSeenAssistantRenderableContentRef = useRef(false);
  const [hasPendingResponse, setHasPendingResponse] = useState(false);
  /** Captures Date.now() when the user sends a message, so the streaming
   *  summary bar can show an accurate live timer from the actual send time. */
  const lastSendTimestampRef = useRef<number | null>(null);

  // Ensure a stop action from one chat does not suppress the in-flight state
  // after switching to a different chat.
  useEffect(() => {
    setUserStopped(false);
  }, [chatInfo.id]);

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
      setUserStopped(false);
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
  const effectiveStatus = userStopped
    ? "ready"
    : hasPendingResponse
      ? "streaming"
      : status;
  const _isChatReady = effectiveStatus === "ready";
  const _isFinalizingGitActions = gitFinalizationState.isFinalizing;
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
  const latestTodos = useMemo(() => getLatestTodos(messages), [messages]);

  const groupedRenderMessages = useMemo<GroupedRenderMessage[]>(() => {
    return renderMessages.map((message, messageIndex) => {
      const groups: MessageRenderGroup[] = [];
      let currentReasoningGroup: ReasoningMessagePart[] = [];
      let reasoningGroupStartIndex = 0;
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

      const flushReasoningGroup = () => {
        if (currentReasoningGroup.length === 0) return;

        groups.push({
          type: "reasoning-group",
          parts: currentReasoningGroup,
          startIndex: reasoningGroupStartIndex,
          renderKey: `reasoning-group:${getStablePartRenderKey(currentReasoningGroup[0])}`,
        });
        currentReasoningGroup = [];
      };

      message.parts.forEach((part, index) => {
        if (isReasoningUIPart(part)) {
          if (currentReasoningGroup.length === 0) {
            reasoningGroupStartIndex = index;
          }
          currentReasoningGroup.push(part);
          return;
        }

        flushReasoningGroup();
        groups.push({
          type: "part",
          part,
          index,
          renderKey: getStablePartRenderKey(part),
        });
      });

      flushReasoningGroup();

      return {
        message,
        groups,
        isStreaming:
          isChatInFlight && messageIndex === renderMessages.length - 1,
      };
    });
  }, [renderMessages, isChatInFlight]);
  const streamdownComponents = useMemo(
    () => ({
      a: (props: AssistantFileLinkProps) => (
        <AssistantFileLink
          {...props}
          onOpenFile={(filePath) => {
            setSelectedWorkspaceFile(filePath);
          }}
        />
      ),
    }),
    [],
  );
  const [isUpdatingModel, setIsUpdatingModel] = useState(false);
  const lastStatusSyncAtRef = useRef(0);
  const statusSyncInFlightRef = useRef(false);
  const pendingOptimisticTitleChatIdRef = useRef<string | null>(null);
  const hasRequestedSessionTitleGenerationRef = useRef(false);
  const markReadRef = useRef<{
    lastAt: number;
    lastChatId: string | null;
    inFlight: boolean;
  }>({
    lastAt: 0,
    lastChatId: null,
    inFlight: false,
  });
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
  const tabResumeRefreshRef = useRef({
    pending: false,
    inFlight: false,
    lastAt: 0,
  });

  const refreshCurrentChatSnapshot = useCallback(async (): Promise<void> => {
    const response = await fetch(
      `/api/sessions/${session.id}/chats/${chatInfo.id}`,
      {
        cache: "no-store",
      },
    );
    if (!response.ok) {
      return;
    }

    const data = (await response.json()) as ChatRefreshResponse;
    if (data.isStreaming) {
      return;
    }

    clearError();
    setMessages(data.messages);
  }, [chatInfo.id, clearError, session.id, setMessages]);

  const refreshAfterTabResume = useCallback(async (): Promise<void> => {
    if (
      typeof document !== "undefined" &&
      (document.visibilityState !== "visible" || !document.hasFocus())
    ) {
      return;
    }

    tabResumeRefreshRef.current.pending = false;

    const now = Date.now();
    if (tabResumeRefreshRef.current.inFlight) {
      return;
    }
    if (now - tabResumeRefreshRef.current.lastAt < 3_000) {
      return;
    }

    tabResumeRefreshRef.current.inFlight = true;
    try {
      await Promise.allSettled([
        requestStatusSync("force"),
        refreshCurrentChatSnapshot(),
        refreshChats(),
        refreshGitStatus(),
        refreshDiff(),
        refreshFiles(),
        refreshSkills(),
        checkBranchAndPr(),
      ]);
    } finally {
      tabResumeRefreshRef.current.lastAt = Date.now();
      tabResumeRefreshRef.current.inFlight = false;
    }
  }, [
    checkBranchAndPr,
    refreshChats,
    refreshCurrentChatSnapshot,
    refreshDiff,
    refreshFiles,
    refreshGitStatus,
    refreshSkills,
    requestStatusSync,
  ]);

  useEffect(() => {
    requestMarkChatReadRef.current = requestMarkChatRead;
  }, [requestMarkChatRead]);

  useEffect(() => {
    hasRequestedSessionTitleGenerationRef.current = false;
  }, [session.id]);

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
      if (document.visibilityState !== "visible") {
        tabResumeRefreshRef.current.pending = true;
        return;
      }

      void requestMarkChatRead("normal");
      if (!tabResumeRefreshRef.current.pending) {
        return;
      }

      void refreshAfterTabResume();
    };
    const handleWindowBlur = () => {
      tabResumeRefreshRef.current.pending = true;
    };
    const handleWindowFocus = () => {
      void requestMarkChatRead("normal");
      if (!tabResumeRefreshRef.current.pending) {
        return;
      }

      void refreshAfterTabResume();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("focus", handleWindowFocus);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [refreshAfterTabResume, requestMarkChatRead]);

  useStreamRecovery({
    sessionId: session.id,
    chatId: chatInfo.id,
    status,
    isChatInFlight,
    hasAssistantRenderableContent,
    retryChatStream,
  });

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

  const selectedModelOption = useMemo(
    () => modelOptions.find((option) => option.id === chatInfo.modelId),
    [modelOptions, chatInfo.modelId],
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
  const [sandboxCreateError, setSandboxCreateError] =
    useState<SandboxCreateErrorDetails | null>(null);
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

  const sendMessageWithPendingState = useCallback(
    async (message: Parameters<typeof sendMessage>[0]) => {
      setHasPendingResponse(true);
      setUserStopped(false);
      lastSendTimestampRef.current = Date.now();
      hasSeenAssistantRenderableContentRef.current = false;
      void setChatStreaming(chatInfo.id, true);

      try {
        await sendMessage(message);
      } catch (error) {
        setHasPendingResponse(false);
        void setChatStreaming(chatInfo.id, false);
        throw error;
      }
    },
    [chatInfo.id, sendMessage, setChatStreaming],
  );

  const handleFixChecks = useCallback(
    async (failedRuns: PullRequestCheckRun[]) => {
      const names = failedRuns.map((run) => run.name).join(", ");
      const fallbackPrompt = `# Fix Failing Checks\n\nThe following checks are failing: ${names}. Please investigate and push a fix.`;
      let messagePayload: Parameters<typeof sendMessageWithPendingState>[0] = {
        text: fallbackPrompt,
      };

      try {
        const res = await fetch(`/api/sessions/${session.id}/checks/fix`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checkRuns: failedRuns }),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            prompt?: string;
            snippets?: Array<{ filename: string; content: string }>;
            message?: string;
          };
          const prompt = data.prompt?.trim() || data.message?.trim();
          const snippets = Array.isArray(data.snippets) ? data.snippets : [];

          if (prompt && snippets.length > 0) {
            messagePayload = {
              parts: [
                {
                  type: "text" as const,
                  text: prompt,
                },
                ...snippets.map((snippet, index) => ({
                  type: "data-snippet" as const,
                  id: `fix-check-${index}`,
                  data: snippet,
                })),
              ],
            };
          } else if (prompt) {
            messagePayload = { text: prompt };
          }
        }
      } catch {
        // Fall through to fallback
      }

      await sendMessageWithPendingState(messagePayload);
    },
    [sendMessageWithPendingState, session.id],
  );

  const handleFixConflicts = useCallback(
    async (baseBranchRef: string, closeMergeDialog = false) => {
      if (closeMergeDialog) {
        setMergeDialogOpen(false);
      }

      await sendMessageWithPendingState({
        text: `# Resolve Merge Conflicts\n\nThere is a merge conflict with ${baseBranchRef}. Fetch and then fix the conflicts. Do not rebase.`,
      });
    },
    [sendMessageWithPendingState],
  );

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

      const resendTextParts = targetMessage.parts
        .filter(
          (part): part is Extract<WebAgentUIMessagePart, { type: "text" }> =>
            part.type === "text",
        )
        .map((part) => ({
          type: "text" as const,
          text: part.text,
        }));
      const resendText = resendTextParts.map((part) => part.text).join("");
      const resendFiles = targetMessage.parts
        .filter((part): part is FileUIPart => part.type === "file")
        .map((part) => ({
          type: "file" as const,
          mediaType: part.mediaType,
          url: part.url,
          ...(part.filename ? { filename: part.filename } : {}),
        }));
      const resendSnippets = targetMessage.parts
        .filter(
          (part): part is WebAgentSnippetDataPart =>
            part.type === "data-snippet",
        )
        .map((part) => ({
          type: "data-snippet" as const,
          id: part.id,
          data: {
            content: part.data.content,
            filename: part.data.filename,
          },
        }));

      if (
        !resendText.trim() &&
        resendFiles.length === 0 &&
        resendSnippets.length === 0
      ) {
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
        await sendMessageWithPendingState(
          resendSnippets.length > 0
            ? {
                parts: [...resendTextParts, ...resendFiles, ...resendSnippets],
              }
            : {
                text: resendText,
                files: resendFiles.length > 0 ? resendFiles : undefined,
              },
        );

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
      sendMessageWithPendingState,
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

  const refreshWorkspaceAfterRestore = useCallback(async () => {
    await requestStatusSync("force").catch(() => undefined);
    await Promise.all([
      refreshGitStatus().catch(() => undefined),
      refreshDiff().catch(() => undefined),
      refreshFiles().catch(() => undefined),
      checkBranchAndPr().catch(() => undefined),
    ]);
  }, [
    requestStatusSync,
    refreshGitStatus,
    refreshDiff,
    refreshFiles,
    checkBranchAndPr,
  ]);

  const handleRestoreSnapshot = useCallback(async () => {
    setIsRestoringSnapshot(true);
    setRestoreError(null);

    try {
      // Resume through the compatibility endpoint. This resumes the named
      // persistent sandbox when available, or lazily migrates a legacy snapshot.
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
          shouldRefreshRestoredWorkspaceRef.current = true;
          const reconnected = await waitForSandboxReady();
          if (!reconnected) {
            setRestoreError(
              "Sandbox is already running. Refresh in a few seconds if it does not reconnect automatically.",
            );
          }
          return;
        }

        shouldRefreshRestoredWorkspaceRef.current = false;
        setRestoreError(`Sandbox resume failed: ${errorMsg}`);
        return;
      }

      if (payload.alreadyRunning) {
        shouldRefreshRestoredWorkspaceRef.current = true;
        const reconnected = await waitForSandboxReady();
        if (!reconnected) {
          setRestoreError(
            "Sandbox is already running. Refresh in a few seconds if it does not reconnect automatically.",
          );
        }
        return;
      }

      // Keep preferred sandbox mode aligned with the preserved session state.
      setSandboxTypeFromUnknown(session.sandboxState?.type);
      shouldRefreshRestoredWorkspaceRef.current = true;

      // Refresh local timeout/connection data from server state.
      const reconnected = await waitForSandboxReady();
      if (!reconnected) {
        setRestoreError(
          "Sandbox resumed, but reconnect did not complete yet. Try Resume sandbox again.",
        );
      }
    } catch (err) {
      shouldRefreshRestoredWorkspaceRef.current = false;
      const errorMsg = err instanceof Error ? err.message : String(err);
      setRestoreError(`Failed to resume sandbox: ${errorMsg}`);
    } finally {
      setIsRestoringSnapshot(false);
    }
  }, [
    session.id,
    session.sandboxState,
    setSandboxTypeFromUnknown,
    waitForSandboxReady,
  ]);

  const handleCreateNewSandbox = useCallback(async () => {
    setIsCreatingSandbox(true);
    setSandboxCreateError(null);

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
      setSandboxCreateError(null);
      void requestStatusSync("force");
    } catch (err) {
      const details = getSandboxCreateErrorDetails(err);
      setSandboxCreateError(details);
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

  // After a chat turn completes, immediately sync state from the server.
  // Auto-commit itself runs server-side so it still happens when this page is
  // not open; the client just reconciles git, diff, and PR state.
  // Initialize to null (not `status`) so the first render always reconciles.
  // When navigating back to a chat whose stream finished in the background,
  // status is already "ready" but the optimistic streaming overlay may still
  // be set. Starting from null makes `becameReady` true on mount, which clears
  // the stale overlay immediately.
  const prevStatusRef = useRef<string | null>(null);
  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    const wasStreaming = prevStatus === "streaming";
    const wasSubmitted = prevStatus === "submitted";
    const becameReady = status === "ready" && prevStatus !== "ready";
    const becameError = status === "error" && prevStatus !== "error";
    const shouldClearStreaming = status === "error" || becameReady;
    prevStatusRef.current = status;

    // Skip clearing the streaming overlay during unmount. Route teardown aborts
    // local transport connections, which can still trigger a transient status
    // transition before React finishes unmounting. Clearing here would remove
    // the optimistic streaming badge even though the server-side stream may
    // still be running. SWR polling + overlay reconciliation clear it once the
    // server confirms the stream has actually ended.
    if (shouldClearStreaming && isMountedRef.current) {
      void setChatStreaming(chatInfo.id, false);
    }
    if (becameError && pendingOptimisticTitleChatIdRef.current) {
      void clearChatTitle(pendingOptimisticTitleChatIdRef.current);
      pendingOptimisticTitleChatIdRef.current = null;
    }
    if (becameReady) {
      pendingOptimisticTitleChatIdRef.current = null;
    }

    let followUpTimeout: ReturnType<typeof setTimeout> | null = null;
    if (
      (wasStreaming || wasSubmitted) &&
      status === "ready" &&
      isMountedRef.current
    ) {
      if (!userStopped) {
        markAutoCommitStarted();
      }

      const refreshCompletedTurnState = async () => {
        await requestStatusSync("force").catch(() => undefined);
        await refreshGitStatus().catch(() => undefined);
        await refreshDiff().catch(() => undefined);
        await refreshFiles().catch(() => undefined);
        await checkBranchAndPr().catch(() => undefined);
      };

      void refreshCompletedTurnState();
      void requestMarkChatRead("force");
      void refreshChats();

      if (session.cloneUrl && session.repoOwner && session.repoName) {
        followUpTimeout = setTimeout(() => {
          void refreshCompletedTurnState();
        }, 3000);
      }
    }

    return () => {
      if (followUpTimeout !== null) {
        clearTimeout(followUpTimeout);
      }
    };
  }, [
    status,
    chatInfo.id,
    setChatStreaming,
    clearChatTitle,
    requestStatusSync,
    refreshGitStatus,
    refreshDiff,
    refreshFiles,
    checkBranchAndPr,
    requestMarkChatRead,
    refreshChats,
    session.cloneUrl,
    session.repoOwner,
    session.repoName,
    markAutoCommitStarted,
    userStopped,
  ]);

  // Track whether we've auto-attempted sandbox startup for this page load.
  const hasAutoStartedSandboxRef = useRef(false);
  const hasHandledInitialSandboxEntryRef = useRef(false);
  const shouldRefreshRestoredWorkspaceRef = useRef(false);

  const isArchived = session.status === "archived";
  const isAutoRestoringOnEntry =
    !hasHandledInitialSandboxEntryRef.current &&
    !isArchived &&
    hasSnapshot &&
    !sandboxInfo &&
    !isCreatingSandbox &&
    !isRestoringSnapshot &&
    reconnectionStatus === "no_sandbox";

  // After a snapshot restore, wait for the live workspace hooks to be active
  // again before forcing refreshes. Calling the pre-restore callbacks inside
  // the async restore handler can be a no-op because they were created while
  // the sandbox was still offline.
  useEffect(() => {
    if (!shouldRefreshRestoredWorkspaceRef.current) {
      return;
    }
    if (!sandboxInfo || reconnectionStatus !== "connected") {
      return;
    }

    shouldRefreshRestoredWorkspaceRef.current = false;
    void refreshWorkspaceAfterRestore();
  }, [sandboxInfo, reconnectionStatus, refreshWorkspaceAfterRestore]);

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

  useEffect(() => {
    if (isArchived) {
      return;
    }
    if (hasHandledInitialSandboxEntryRef.current) {
      return;
    }
    if (reconnectionStatus === "idle" || reconnectionStatus === "checking") {
      return;
    }

    hasHandledInitialSandboxEntryRef.current = true;

    if (isAutoRestoringOnEntry) {
      void handleRestoreSnapshot();
    }
  }, [
    handleRestoreSnapshot,
    isArchived,
    isAutoRestoringOnEntry,
    reconnectionStatus,
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
      setSandboxCreateError(null);

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
      setSandboxCreateError(null);
      void requestStatusSync("force");
      return true;
    } catch (err) {
      const details = getSandboxCreateErrorDetails(err);
      setSandboxCreateError(details);
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

    // Paused sessions require an explicit Resume action.
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

  const tokenUsage = useMemo(
    () => getLatestContextUsage(renderMessages),
    [renderMessages],
  );
  const conversationUsage = useMemo(
    () => getConversationUsage(renderMessages),
    [renderMessages],
  );
  const conversationEstimatedCost = useMemo(
    () =>
      getConversationEstimatedCost(renderMessages, selectedModelOption?.cost),
    [renderMessages, selectedModelOption?.cost],
  );

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

  // Stable empty array so the hook doesn't reset on every render when there's no question
  const emptyQuestions = useMemo(
    () => [] as AskUserQuestionInput["questions"],
    [],
  );

  const inlineQuestion = useInlineQuestion({
    questions:
      hasPendingQuestion && pendingQuestionPart
        ? pendingQuestionPart.input.questions
        : emptyQuestions,
    onSubmit: handleQuestionSubmit,
    onCancel: handleQuestionCancel,
    textareaValue: input,
    onTextareaChange: setInput,
  });

  // Inline question UI is integrated into the prompt box on all viewports
  const showInlineQuestion = inlineQuestion.isActive;

  const isReconnectingSandbox =
    reconnectionStatus === "checking" &&
    !sandboxInfo &&
    !isCreatingSandbox &&
    !isRestoringSnapshot;
  const isHibernatingTransition =
    isReconnectingSandbox && hasSnapshot && !hasRuntimeSandboxState;
  const isArchiveSnapshotPending = isArchived && hasRuntimeSandboxState;
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

  const _sandboxUiStatus = useMemo(() => {
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
  const canRunDevServer =
    !isArchived &&
    isSandboxActive &&
    !isCreatingSandbox &&
    !isRestoringSnapshot &&
    !isReconnectingSandbox &&
    !isHibernatingUi;
  const canUseCodeEditor = codeEditorDisabledReason === null;
  const devServer = useDevServer({
    sessionId: session.id,
    canRun: canRunDevServer,
  });
  const codeEditor = useCodeEditor({
    sessionId: session.id,
    canRun: canRunDevServer && canUseCodeEditor,
  });
  const isCodeEditorActionDisabled =
    !canUseCodeEditor ||
    codeEditor.state.status === "starting" ||
    codeEditor.state.status === "stopping";

  const hasRepo = Boolean(session.cloneUrl);
  const hasExistingPr = session.prNumber != null;
  const previewLookupBranch =
    gitStatus?.branch && gitStatus.branch !== "HEAD"
      ? gitStatus.branch
      : session.branch;
  const hasBranchPreviewLookup = Boolean(
    session.vercelProjectId && previewLookupBranch,
  );
  const existingPrUrl =
    hasExistingPr && session.repoOwner && session.repoName
      ? `https://github.com/${session.repoOwner}/${session.repoName}/pull/${session.prNumber}`
      : null;
  const prDeploymentQuery = new URLSearchParams(
    Object.entries({
      ...(hasExistingPr ? { prNumber: String(session.prNumber) } : {}),
      ...(previewLookupBranch ? { branch: previewLookupBranch } : {}),
    }),
  ).toString();
  const { data: prDeploymentData, mutate: refreshPrDeployment } =
    useSWR<PrDeploymentResponse>(
      hasExistingPr || hasBranchPreviewLookup
        ? `/api/sessions/${session.id}/pr-deployment${
            prDeploymentQuery ? `?${prDeploymentQuery}` : ""
          }`
        : null,
      fetcher,
      {
        revalidateOnFocus: true,
        revalidateOnReconnect: true,
        // Poll while we're still waiting for the first deployment, or while a
        // branch preview is rolling forward to a newer deployment after a push.
        refreshInterval: (latestData) =>
          getPrDeploymentRefreshInterval({
            shouldPoll: hasExistingPr || hasBranchPreviewLookup,
            deploymentUrl: latestData?.deploymentUrl,
            documentHasFocus:
              typeof document === "undefined" ? true : document.hasFocus(),
            waitForDeploymentUrlChangeFrom: branchPreviewUrlChangeBaseline,
          }),
        shouldRetryOnError: false,
      },
    );
  const prDeploymentUrl = prDeploymentData?.deploymentUrl ?? null;
  const buildingDeploymentUrl = prDeploymentData?.buildingDeploymentUrl ?? null;
  const failedDeploymentUrl = prDeploymentData?.failedDeploymentUrl ?? null;

  useEffect(() => {
    if (!hasExistingPr && !hasBranchPreviewLookup) {
      if (branchPreviewUrlChangeBaseline !== undefined) {
        setBranchPreviewUrlChangeBaseline(undefined);
      }
      return;
    }

    if (branchPreviewUrlChangeBaseline === undefined) {
      return;
    }

    if (prDeploymentUrl !== branchPreviewUrlChangeBaseline) {
      setBranchPreviewUrlChangeBaseline(undefined);
    }
  }, [
    hasExistingPr,
    hasBranchPreviewLookup,
    branchPreviewUrlChangeBaseline,
    prDeploymentUrl,
  ]);

  const isDeploymentStale = branchPreviewUrlChangeBaseline !== undefined;
  const isDeploymentFailed =
    !prDeploymentUrl &&
    !buildingDeploymentUrl &&
    !hasExistingPr &&
    Boolean(failedDeploymentUrl);
  const previewDeploymentTargetUrl =
    (isDeploymentStale ? buildingDeploymentUrl : null) ??
    prDeploymentUrl ??
    (isDeploymentFailed ? failedDeploymentUrl : null);
  const showHeaderActions =
    canRunDevServer || Boolean(previewDeploymentTargetUrl);

  // When auto-commit lands (transitions from committing to clean), mark the
  // current preview deployment as stale so the UI shows "Deploying…" until
  // the new Vercel build finishes.
  const prevIsAutoCommittingRef = useRef(isAutoCommitting);
  useEffect(() => {
    const wasAutoCommitting = prevIsAutoCommittingRef.current;
    prevIsAutoCommittingRef.current = isAutoCommitting;

    if (
      wasAutoCommitting &&
      !isAutoCommitting &&
      (hasExistingPr || hasBranchPreviewLookup)
    ) {
      setBranchPreviewUrlChangeBaseline(prDeploymentUrl);
      refreshPrDeployment().catch(() => undefined);
    }
  }, [
    isAutoCommitting,
    hasExistingPr,
    hasBranchPreviewLookup,
    prDeploymentUrl,
    refreshPrDeployment,
  ]);

  const hasUncommittedGitChanges = gitStatus?.hasUncommittedChanges ?? false;
  const hasUnpushedCommits = gitStatus?.hasUnpushedCommits ?? false;
  const showCommitAction =
    hasRepo &&
    (hasUncommittedGitChanges || (hasExistingPr && hasUnpushedCommits));

  // Sync the "action needed" indicator for the right sidebar toggle button
  useEffect(() => {
    setHasActionNeeded(showCommitAction);
  }, [showCommitAction, setHasActionNeeded]);

  // Sync the file change count for the badge on the toggle button
  const totalChangesCount = diff?.files?.length ?? 0;
  useEffect(() => {
    setChangesCount(totalChangesCount);
  }, [totalChangesCount, setChangesCount]);

  // Sync the "committed changes" indicator (blue dot) — branch has committed
  // changes, no PR created yet, and no uncommitted changes to deal with
  useEffect(() => {
    setHasCommittedChanges(
      hasRepo &&
        totalChangesCount > 0 &&
        !hasExistingPr &&
        !hasUncommittedGitChanges,
    );
  }, [
    hasRepo,
    totalChangesCount,
    hasExistingPr,
    hasUncommittedGitChanges,
    setHasCommittedChanges,
  ]);
  const hasOpenPr = hasExistingPr && session.prStatus === "open";
  const canCloseAndArchive = hasOpenPr && !isArchived;
  const handleCommitted = useCallback(async () => {
    if (hasExistingPr || hasBranchPreviewLookup) {
      setBranchPreviewUrlChangeBaseline(prDeploymentUrl);
    }

    await Promise.all([
      refreshGitStatus().catch(() => undefined),
      refreshDiff().catch(() => undefined),
      refreshFiles().catch(() => undefined),
      checkBranchAndPr().catch(() => undefined),
    ]);

    if (hasExistingPr || hasBranchPreviewLookup) {
      await refreshPrDeployment().catch(() => undefined);
    }
  }, [
    hasExistingPr,
    hasBranchPreviewLookup,
    prDeploymentUrl,
    refreshGitStatus,
    refreshDiff,
    refreshFiles,
    checkBranchAndPr,
    refreshPrDeployment,
  ]);

  const handleMerged = useCallback(
    async (mergeResult: MergePullRequestResponse) => {
      updateSessionPullRequest({
        prNumber: mergeResult.prNumber,
        prStatus: "merged",
      });

      if (mergeResult.branchDeleteError) {
        console.warn(
          "PR merged but source branch was not deleted:",
          mergeResult.branchDeleteError,
        );
      }

      try {
        await archiveSession();
        router.push("/sessions");
      } catch (archiveError) {
        const archiveMessage =
          archiveError instanceof Error
            ? archiveError.message
            : "Failed to archive session";
        throw new Error(
          `Pull request merged, but archiving the session failed: ${archiveMessage}`,
          {
            cause: archiveError,
          },
        );
      }
    },
    [archiveSession, router, updateSessionPullRequest],
  );

  const handleClosed = useCallback(
    async (closeResult: { closed: boolean; prNumber: number }) => {
      updateSessionPullRequest({
        prNumber: closeResult.prNumber,
        prStatus: "closed",
      });

      try {
        await archiveSession();
        router.push("/sessions");
      } catch (archiveError) {
        const archiveMessage =
          archiveError instanceof Error
            ? archiveError.message
            : "Failed to archive session";
        throw new Error(
          `Pull request closed, but archiving the session failed: ${archiveMessage}`,
          {
            cause: archiveError,
          },
        );
      }
    },
    [archiveSession, router, updateSessionPullRequest],
  );

  const gitPanelElement = gitPanelOpen ? (
    <GitPanel
      session={session}
      hasRepo={hasRepo}
      hasExistingPr={hasExistingPr}
      existingPrUrl={existingPrUrl}
      prDeploymentUrl={prDeploymentUrl}
      buildingDeploymentUrl={buildingDeploymentUrl}
      failedDeploymentUrl={failedDeploymentUrl}
      isDeploymentStale={isDeploymentStale}
      isDeploymentFailed={isDeploymentFailed}
      hasUncommittedGitChanges={hasUncommittedGitChanges}
      supportsRepoCreation={supportsRepoCreation}
      hasDiff={Boolean(diff || session.cachedDiff)}
      canCloseAndArchive={canCloseAndArchive}
      diffFiles={diff?.files ?? null}
      diffSummary={diff?.summary ?? null}
      diffRefreshing={diffRefreshing}
      onCreateRepoClick={() => setRepoDialogOpen(true)}
      refreshDiff={refreshDiff}
      onMerged={handleMerged}
      onCloseAndArchiveClick={() => setCloseDialogOpen(true)}
      onFixChecks={handleFixChecks}
      onFixConflicts={(baseBranchRef) => handleFixConflicts(baseBranchRef)}
      hasSandbox={sandboxInfo !== null}
      gitStatus={gitStatus}
      gitStatusLoading={gitStatusLoading}
      refreshGitStatus={refreshGitStatus}
      onCommitted={handleCommitted}
      isAgentWorking={hasPendingResponse || isChatInFlight}
      onPrDetected={(pr) => {
        updateSessionPullRequest(pr);
        void refreshGitStatus().catch(() => {});
      }}
      onGitMessage={upsertSyntheticAssistantGitMessage}
    />
  ) : null;

  return (
    <>
      {/* Git panel portaled to layout-level for full page height */}
      {gitPanelOpen &&
        panelPortalRef.current &&
        createPortal(gitPanelElement, panelPortalRef.current)}

      {/* Header actions portaled from chat-level state */}
      {headerActionsRef.current &&
        showHeaderActions &&
        createPortal(
          <div className="flex items-center gap-1">
            {canRunDevServer && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="hidden sm:inline-flex">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => void codeEditor.handleOpen()}
                        disabled={isCodeEditorActionDisabled}
                      >
                        {codeEditor.state.status === "starting" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Code2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent
                    side="bottom"
                    className="max-w-72 text-pretty"
                  >
                    {codeEditorDisabledReason ?? codeEditor.menuLabel}
                  </TooltipContent>
                </Tooltip>
                <div className="hidden h-7 items-center sm:flex">
                  {devServer.state.status === "ready" ? (
                    <div className="flex items-center rounded-md border border-border px-0.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 rounded-sm"
                            onClick={() => void devServer.handlePrimaryAction()}
                          >
                            <Globe className="h-3 w-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          Open dev server
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 rounded-sm"
                            onClick={() => void devServer.handleStopAction()}
                          >
                            <Square className="h-2.5 w-2.5 fill-current" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          Stop dev server
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  ) : devServer.state.status === "starting" ||
                    devServer.state.status === "stopping" ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled
                        >
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        {devServer.state.status === "starting"
                          ? "Starting dev server..."
                          : "Stopping dev server..."}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => void devServer.handlePrimaryAction()}
                        >
                          <Play className="h-3.5 w-3.5 fill-current" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        Start dev server
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </>
            )}
            {previewDeploymentTargetUrl && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    asChild
                    variant="ghost"
                    size="icon"
                    className="hidden h-7 w-7 sm:inline-flex"
                  >
                    <a
                      href={previewDeploymentTargetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={
                        isDeploymentStale
                          ? "Open latest preview deployment (building)"
                          : "Open latest preview deployment"
                      }
                    >
                      <Globe
                        className={cn(
                          "h-3.5 w-3.5",
                          isDeploymentFailed && "text-red-500",
                          !isDeploymentFailed &&
                            !isDeploymentStale &&
                            "text-green-500",
                          !isDeploymentFailed &&
                            isDeploymentStale &&
                            "animate-pulse text-amber-500",
                        )}
                      />
                    </a>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {isDeploymentStale
                    ? "Open latest preview deployment (building)"
                    : "Open latest preview deployment"}
                </TooltipContent>
              </Tooltip>
            )}
          </div>,
          headerActionsRef.current,
        )}
      <div className="flex h-full flex-col overflow-hidden">
        {/* Share dialog (triggered from header) */}
        <ShareDialog
          sessionId={session.id}
          chatId={chatInfo.id}
          initialShareId={null}
          externalOpen={mobileShareOpen || shareRequested}
          onExternalOpenChange={(open) => {
            setMobileShareOpen(open);
            if (!open) setShareRequested(false);
          }}
        />

        {/* Archive confirmation dialog */}
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

        {/* Main content: chat, diff, or file */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {activeView === "diff" ? (
            <DiffTabView />
          ) : activeView === "file" ? (
            <FileTabView />
          ) : (
            <>
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
                    <OpenFileProvider
                      onOpenFile={(fp) => setSelectedWorkspaceFile(fp)}
                    >
                      <div className="space-y-6">
                        {groupedRenderMessages.length === 0 &&
                          !hasPendingResponse && (
                            <div className="flex h-full min-h-[40vh] items-center justify-center">
                              {!isArchived &&
                              (isCreatingSandbox ||
                                isRestoringSnapshot ||
                                isReconnectingSandbox ||
                                isHibernatingUi ||
                                isServerRestoring ||
                                !isSandboxActive) ? (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  <p>Sandbox is initializing…</p>
                                </div>
                              ) : (
                                <p className="text-sm text-muted-foreground">
                                  Send a message to get started
                                </p>
                              )}
                            </div>
                          )}
                        {groupedRenderMessages.map(
                          ({
                            message: m,
                            groups,
                            isStreaming: isMessageStreaming,
                          }) => {
                            const renderGroups = (
                              isToolCallsExpanded: boolean,
                            ) =>
                              groups.map((group) => {
                                if (group.type === "reasoning-group") {
                                  if (!isToolCallsExpanded) return null;
                                  const hasRenderableContentAfterGroup = m.parts
                                    .slice(
                                      group.startIndex + group.parts.length,
                                    )
                                    .some(hasRenderableAssistantPart);

                                  return (
                                    <div
                                      key={`${m.id}-${group.renderKey}`}
                                      className="max-w-full pl-[22px]"
                                    >
                                      <ThinkingBlock
                                        text={getReasoningGroupText(
                                          group.parts,
                                        )}
                                        isStreaming={shouldKeepCollapsedReasoningStreaming(
                                          {
                                            isMessageStreaming,
                                            hasStreamingReasoningPart:
                                              group.parts.some(
                                                (part) =>
                                                  part.state === "streaming",
                                              ),
                                            hasRenderableContentAfterGroup,
                                          },
                                        )}
                                        partCount={group.parts.length}
                                      />
                                    </div>
                                  );
                                }

                                const p = group.part;

                                if (isReasoningUIPart(p)) {
                                  if (!isToolCallsExpanded) return null;
                                  const hasRenderableContentAfterGroup = m.parts
                                    .slice(group.index + 1)
                                    .some(hasRenderableAssistantPart);

                                  return (
                                    <div
                                      key={`${m.id}-${group.renderKey}`}
                                      className="max-w-full pl-[22px]"
                                    >
                                      <ThinkingBlock
                                        text={p.text}
                                        isStreaming={shouldKeepCollapsedReasoningStreaming(
                                          {
                                            isMessageStreaming,
                                            hasStreamingReasoningPart:
                                              p.state === "streaming",
                                            hasRenderableContentAfterGroup,
                                          },
                                        )}
                                      />
                                    </div>
                                  );
                                }

                                if (p.type === "text") {
                                  if (p.text.length === 0) {
                                    return null;
                                  }

                                  const isFinalAssistantTextPart =
                                    m.role === "assistant" &&
                                    !m.parts
                                      .slice(group.index + 1)
                                      .some(
                                        (messagePart) =>
                                          messagePart.type === "text",
                                      );

                                  // When collapsed, hide every text part except the
                                  // final one.  The final text part streams in live so
                                  // the user always sees the latest assistant prose.
                                  if (
                                    !isToolCallsExpanded &&
                                    m.role === "assistant" &&
                                    !isFinalAssistantTextPart
                                  ) {
                                    return null;
                                  }

                                  const canCopyAssistantMessage =
                                    isFinalAssistantTextPart &&
                                    !isMessageStreaming &&
                                    p.text.trim().length > 0;

                                  return (
                                    <div
                                      key={`${m.id}-${group.renderKey}`}
                                      className={cn(
                                        "flex min-w-0 py-2",
                                        m.role === "user"
                                          ? "justify-end"
                                          : "justify-start",
                                        // Breathing room above final assistant text after tool calls
                                        isFinalAssistantTextPart &&
                                          group.index > 0 &&
                                          "mt-4",
                                        // Indent non-final text parts (they're collapsible content)
                                        m.role === "assistant" &&
                                          !isFinalAssistantTextPart &&
                                          "pl-[22px]",
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
                                                  void handleResendUserMessage(
                                                    m.id,
                                                  )
                                                }
                                                disabled={
                                                  hasMessageActionInFlight
                                                }
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
                                                  void handleDeleteUserMessage(
                                                    m.id,
                                                  )
                                                }
                                                disabled={
                                                  hasMessageActionInFlight
                                                }
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
                                        <div className="group min-w-0 w-full overflow-hidden">
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
                                              isMessageStreaming
                                                ? "streaming"
                                                : "static"
                                            }
                                            isAnimating={isMessageStreaming}
                                            components={streamdownComponents}
                                            plugins={streamdownPlugins}
                                          >
                                            {p.text}
                                          </Streamdown>
                                          {canCopyAssistantMessage && (
                                            <div className="mt-1 flex justify-start">
                                              <div className="flex items-center gap-1">
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    void handleCopyAssistantMessage(
                                                      m.id,
                                                      p.text,
                                                    )
                                                  }
                                                  aria-label="Copy assistant response"
                                                  className="rounded p-1 text-muted-foreground opacity-0 transition hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                                                >
                                                  {copiedAssistantMessageId ===
                                                  m.id ? (
                                                    <Check className="h-4 w-4" />
                                                  ) : (
                                                    <Copy className="h-4 w-4" />
                                                  )}
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    void handleForkAssistantMessage(
                                                      m.id,
                                                    )
                                                  }
                                                  disabled={
                                                    forkingAssistantMessageId !==
                                                    null
                                                  }
                                                  aria-label="Fork conversation from this response"
                                                  className={cn(
                                                    "rounded p-1 text-muted-foreground opacity-0 transition hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-40",
                                                    forkingAssistantMessageId ===
                                                      m.id && "opacity-100",
                                                  )}
                                                >
                                                  {forkingAssistantMessageId ===
                                                  m.id ? (
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                  ) : (
                                                    <GitBranch className="h-4 w-4" />
                                                  )}
                                                </button>
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                }

                                if (isToolUIPart(p)) {
                                  if (!isToolCallsExpanded) return null;
                                  return (
                                    <div
                                      key={`${m.id}-${group.renderKey}`}
                                      className="max-w-full pl-[22px]"
                                    >
                                      <ToolCall
                                        part={p as WebAgentUIToolPart}
                                        isStreaming={isMessageStreaming}
                                        onApprove={(id) =>
                                          addToolApprovalResponse({
                                            id,
                                            approved: true,
                                          })
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

                                if (isGitDataPart(p)) {
                                  if (!shouldRenderGitDataPart(p)) {
                                    return null;
                                  }

                                  return (
                                    <div
                                      key={`${m.id}-${group.renderKey}`}
                                      className="max-w-full"
                                    >
                                      <GitDataPartCard part={p} />
                                    </div>
                                  );
                                }

                                // Render image attachments
                                if (
                                  p.type === "file" &&
                                  p.mediaType?.startsWith("image/")
                                ) {
                                  if (
                                    !isToolCallsExpanded &&
                                    m.role === "assistant"
                                  ) {
                                    return null;
                                  }
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
                                        {m.role === "user" &&
                                          group.index === 0 && (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                void handleDeleteUserMessage(
                                                  m.id,
                                                )
                                              }
                                              disabled={
                                                hasMessageActionInFlight
                                              }
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

                                if (p.type === "data-snippet") {
                                  if (
                                    !isToolCallsExpanded &&
                                    m.role === "assistant"
                                  ) {
                                    return null;
                                  }
                                  return (
                                    <div
                                      key={`${m.id}-${group.renderKey}`}
                                      className={cn(
                                        "flex",
                                        m.role === "user"
                                          ? "justify-end"
                                          : "justify-start",
                                      )}
                                    >
                                      <div className="group relative w-fit max-w-[80%]">
                                        <SnippetChip
                                          filename={p.data.filename}
                                          content={p.data.content}
                                        />
                                        {m.role === "user" &&
                                          group.index === 0 && (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                void handleDeleteUserMessage(
                                                  m.id,
                                                )
                                              }
                                              disabled={
                                                hasMessageActionInFlight
                                              }
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

                            if (m.role === "assistant") {
                              return (
                                <AssistantMessageGroups
                                  key={m.id}
                                  message={m}
                                  isStreaming={isMessageStreaming}
                                  durationMs={messageDurationMap[m.id] ?? null}
                                  startedAt={
                                    messageStartedAtMap[m.id] ??
                                    (isMessageStreaming
                                      ? lastSendTimestampRef.current
                                        ? new Date(
                                            lastSendTimestampRef.current,
                                          ).toISOString()
                                        : lastUserMessageSentAt
                                      : null)
                                  }
                                >
                                  {renderGroups}
                                </AssistantMessageGroups>
                              );
                            }

                            return (
                              <div key={m.id} className="flex flex-col gap-1">
                                {renderGroups(true)}
                              </div>
                            );
                          },
                        )}
                        {showThinkingIndicator && (
                          <div className="my-1.5 border border-transparent py-0.5">
                            <div className="inline-flex items-center gap-2 rounded-md py-px text-sm text-muted-foreground">
                              <span className="flex size-3.5 shrink-0 items-center justify-center">
                                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-muted-foreground" />
                              </span>
                              <span className="leading-none">Thinking…</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </OpenFileProvider>
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
              <div className="p-4 pb-2 sm:pb-8">
                <div className="mx-auto max-w-4xl space-y-2">
                  {sandboxCreateError && (
                    <SandboxCreateErrorBanner
                      error={sandboxCreateError}
                      onDismiss={() => setSandboxCreateError(null)}
                    />
                  )}
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
                    {/* Pinned Todo Panel — sits above the input box */}
                    <PinnedTodoPanel todos={latestTodos} />
                    {/* Input form */}
                    <div
                      className={`overflow-hidden rounded-2xl bg-muted transition-colors ${isDragging ? "ring-2 ring-blue-500/50" : ""}`}
                    >
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          // When inline question is active, don't send a chat message
                          if (showInlineQuestion) return;
                          if (
                            isArchived ||
                            !isSandboxActive ||
                            isChatInFlight ||
                            hasPendingResponse
                          ) {
                            return;
                          }
                          const hasContent =
                            input.trim() ||
                            images.length > 0 ||
                            textAttachments.length > 0;
                          if (!hasContent) return;

                          const messageText = input;
                          const files = getFileParts();

                          // Build the message payload. When text attachments are
                          // present we use the parts-based form so we can include
                          // data-snippet parts alongside text and file parts.
                          const hasSnippets = textAttachments.length > 0;
                          let messagePayload: Parameters<
                            typeof sendMessageWithPendingState
                          >[0];

                          if (hasSnippets) {
                            const parts: WebAgentUIMessage["parts"] = [];
                            if (messageText.trim()) {
                              parts.push({
                                type: "text" as const,
                                text: messageText,
                              });
                            }
                            if (files) {
                              for (const f of files) {
                                parts.push(f);
                              }
                            }
                            for (const attachment of textAttachments) {
                              parts.push({
                                type: "data-snippet" as const,
                                id: attachment.id,
                                data: {
                                  content: attachment.content,
                                  filename: attachment.filename,
                                },
                              });
                            }
                            messagePayload = { parts };
                          } else {
                            messagePayload = {
                              text: messageText,
                              files,
                            };
                          }

                          setInput("");
                          clearImages();
                          clearTextAttachments();

                          const isFirstChatInSession =
                            initialIsOnlyChatInSession;
                          const shouldSetOptimisticTitle =
                            isFirstChatInSession &&
                            !hadInitialMessages &&
                            messages.length === 0;
                          const trimmedText = messageText.trim();
                          const shouldGenerateSessionTitle =
                            shouldSetOptimisticTitle &&
                            trimmedText.length > 0 &&
                            !hasRequestedSessionTitleGenerationRef.current;
                          if (
                            shouldSetOptimisticTitle &&
                            trimmedText.length > 0
                          ) {
                            const nextTitle =
                              trimmedText.length > 30
                                ? `${trimmedText.slice(0, 30)}...`
                                : trimmedText;
                            pendingOptimisticTitleChatIdRef.current =
                              chatInfo.id;
                            void setChatTitle(chatInfo.id, nextTitle);

                            if (shouldGenerateSessionTitle) {
                              hasRequestedSessionTitleGenerationRef.current = true;
                              // Generate a title in parallel and persist it as soon as it
                              // resolves, without waiting for the assistant response.
                              const generatedTitlePromise = fetch(
                                "/api/generate-title",
                                {
                                  method: "POST",
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                  body: JSON.stringify({
                                    message: trimmedText,
                                  }),
                                },
                              )
                                .then(async (res) => {
                                  if (!res.ok) {
                                    return null;
                                  }

                                  const data = (await res
                                    .json()
                                    .catch(() => null)) as {
                                    title?: unknown;
                                  } | null;
                                  if (typeof data?.title !== "string") {
                                    return null;
                                  }

                                  const title = data.title.trim();
                                  return title.length > 0 ? title : null;
                                })
                                .catch(() => null);

                              void generatedTitlePromise
                                .then((generatedTitle) => {
                                  if (!generatedTitle) {
                                    return;
                                  }
                                  return updateSessionTitle(generatedTitle);
                                })
                                .catch(() => {
                                  // Ignore failures and keep the existing session title.
                                });
                            }
                          }
                          try {
                            await sendMessageWithPendingState(messagePayload);
                          } catch (err) {
                            if (pendingOptimisticTitleChatIdRef.current) {
                              void clearChatTitle(
                                pendingOptimisticTitleChatIdRef.current,
                              );
                              pendingOptimisticTitleChatIdRef.current = null;
                            }
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
                          if (
                            !e.currentTarget.contains(e.relatedTarget as Node)
                          ) {
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
                      >
                        {/* Sandbox overlay when inactive */}
                        <SandboxInputOverlay
                          isSandboxActive={isSandboxActive}
                          isCreating={isCreatingSandbox}
                          isRestoring={isRestoringSnapshot}
                          isReconnecting={
                            isReconnectingSandbox && !isHibernatingUi
                          }
                          isHibernating={isHibernatingUi}
                          isArchived={isArchived}
                          isInitializing={
                            reconnectionStatus === "idle" ||
                            isAutoRestoringOnEntry
                          }
                          snapshotPending={isArchiveSnapshotPending}
                          hasSnapshot={hasSnapshot}
                          onRestore={handleRestoreSnapshot}
                          onCreateNew={handleCreateNewSandbox}
                        />

                        {/* Attachments preview */}
                        {(images.length > 0 || textAttachments.length > 0) && (
                          <div className="flex min-w-0 flex-wrap items-start gap-2 px-2 pb-1 pt-2">
                            {images.length > 0 && (
                              <ImageAttachmentsPreview
                                images={images}
                                onRemove={removeImage}
                                className="p-0"
                              />
                            )}
                            {textAttachments.length > 0 && (
                              <TextAttachmentsPreview
                                attachments={textAttachments}
                                onRemove={removeTextAttachment}
                                className="p-0"
                              />
                            )}
                          </div>
                        )}

                        {/* Inline question UI for mobile — rendered inside prompt box */}
                        {showInlineQuestion && inlineQuestion.questionHeaderUI}

                        {/* Textarea area */}
                        <div className="px-4 pb-2 pt-3">
                          <textarea
                            ref={inputRef}
                            value={input}
                            placeholder={
                              showInlineQuestion
                                ? inlineQuestion.placeholder
                                : "Request changes or ask a question..."
                            }
                            rows={1}
                            onFocus={handleTextareaFocus}
                            onChange={(e) => {
                              setInput(e.currentTarget.value);
                              setCursorPosition(
                                e.currentTarget.selectionStart ?? 0,
                              );
                            }}
                            onKeyDown={(e) => {
                              // When inline question is active, Enter advances the question
                              if (
                                showInlineQuestion &&
                                e.key === "Enter" &&
                                !e.shiftKey
                              ) {
                                e.preventDefault();
                                inlineQuestion.handleNext();
                                return;
                              }
                              // Let suggestions handle keyboard events first
                              if (handleSuggestionsKeyDown(e)) {
                                return;
                              }
                              if (handleSlashKeyDown(e)) {
                                return;
                              }
                              // On iOS, Return should insert a newline (send via submit button)
                              if (
                                e.key === "Enter" &&
                                !e.shiftKey &&
                                !isIosDevice &&
                                !isChatInFlight &&
                                !hasPendingResponse
                              ) {
                                e.preventDefault();
                                if (!isArchived && isSandboxActive) {
                                  e.currentTarget.form?.requestSubmit();
                                }
                              }
                            }}
                            onKeyUp={(e) => {
                              setCursorPosition(
                                e.currentTarget.selectionStart ?? 0,
                              );
                            }}
                            onClick={(e) => {
                              setCursorPosition(
                                e.currentTarget.selectionStart ?? 0,
                              );
                            }}
                            onPaste={(e) => {
                              const items = e.clipboardData?.items;
                              if (items) {
                                for (const item of items) {
                                  if (isValidImageType(item.type)) {
                                    const file = item.getAsFile();
                                    if (file) {
                                      e.preventDefault();
                                      addImage(file).catch(() => {
                                        // Silently ignore paste errors - rare edge case
                                      });
                                      return;
                                    }
                                  }
                                }
                              }

                              // Handle large text pastes – convert to file attachment
                              const pastedText =
                                e.clipboardData?.getData("text/plain");
                              if (pastedText && isLargeText(pastedText)) {
                                e.preventDefault();
                                addTextAttachment(pastedText);
                              }
                            }}
                            disabled={isArchived}
                            className="w-full resize-none overflow-y-auto bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none"
                            style={{ minHeight: "24px" }}
                          />
                        </div>

                        {/* Bottom toolbar */}
                        <div className="flex items-center justify-between gap-2 px-3 pb-2">
                          <div className="flex min-w-0 items-center gap-2 overflow-hidden">
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
                                  isChatInFlight ||
                                  isUpdatingModel ||
                                  modelOptionsLoading
                                    ? "pointer-events-none opacity-60"
                                    : undefined
                                }
                              >
                                <ModelSelectorCompact
                                  value={chatInfo.modelId}
                                  modelOptions={modelOptions}
                                  disabled={
                                    isChatInFlight ||
                                    isUpdatingModel ||
                                    modelOptionsLoading
                                  }
                                  onCloseAutoFocus={() => {
                                    window.requestAnimationFrame(() => {
                                      const textarea = inputRef.current;
                                      if (!textarea) {
                                        return;
                                      }

                                      textarea.focus();
                                      const nextCursorPosition = Math.min(
                                        cursorPosition,
                                        textarea.value.length,
                                      );
                                      textarea.setSelectionRange(
                                        nextCursorPosition,
                                        nextCursorPosition,
                                      );
                                    });
                                  }}
                                  onChange={(modelId) => {
                                    void handleModelChange(modelId);
                                  }}
                                />
                              </div>
                            ) : (
                              chatInfo.modelId && (
                                <span className="max-w-28 truncate text-xs text-muted-foreground/60 sm:max-w-none">
                                  {selectedModelOption?.label ??
                                    chatInfo.modelId}
                                </span>
                              )
                            )}
                            <ContextUsageIndicator
                              inputTokens={tokenUsage.inputTokens}
                              conversationInputTokens={
                                conversationUsage.inputTokens
                              }
                              conversationCachedInputTokens={
                                conversationUsage.cachedInputTokens
                              }
                              conversationOutputTokens={
                                conversationUsage.outputTokens
                              }
                              estimatedConversationCost={
                                conversationEstimatedCost
                              }
                              contextLimit={
                                contextLimit ?? DEFAULT_CONTEXT_LIMIT
                              }
                            />
                          </div>

                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={handleMicClick}
                              disabled={
                                isArchived || recordingState === "processing"
                              }
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

                            {showInlineQuestion ? (
                              <Button
                                type="button"
                                size="sm"
                                onClick={(e) => {
                                  e.preventDefault();
                                  inlineQuestion.handleNext();
                                }}
                                disabled={!inlineQuestion.hasCurrentAnswer}
                                className="h-8 rounded-full bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-30"
                              >
                                <Check className="h-3 w-3" />
                                <span className="sm:hidden">
                                  {inlineQuestion.compactButtonLabel}
                                </span>
                                <span className="hidden sm:inline">
                                  {inlineQuestion.buttonLabel}
                                </span>
                              </Button>
                            ) : isChatInFlight || hasPendingResponse ? (
                              <Button
                                type="button"
                                size="icon"
                                onClick={() => {
                                  stopChatStream();
                                  setHasPendingResponse(false);
                                  setUserStopped(true);
                                  void setChatStreaming(chatInfo.id, false);
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
                                        (!input.trim() &&
                                          images.length === 0 &&
                                          textAttachments.length === 0) ||
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
                    </div>

                    {/* Recording error message */}
                    {recordingError && (
                      <p className="mt-2 text-sm text-destructive">
                        {recordingError}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Merge PR Dialog */}
      {session && (
        <MergePrDialog
          open={mergeDialogOpen}
          onOpenChange={setMergeDialogOpen}
          session={session}
          onMerged={handleMerged}
          onViewDiff={() => setShowDiffPanel(true)}
          canViewDiff={supportsDiff && Boolean(diff || session.cachedDiff)}
          isAgentWorking={hasPendingResponse || isChatInFlight}
          onFixChecks={async (failedRuns) => {
            setMergeDialogOpen(false);
            await handleFixChecks(failedRuns);
          }}
          onFixConflicts={(baseBranchRef) =>
            handleFixConflicts(baseBranchRef, true)
          }
        />
      )}

      {/* Close PR Dialog */}
      {session && (
        <ClosePrDialog
          open={closeDialogOpen}
          onOpenChange={setCloseDialogOpen}
          session={session}
          onClosed={handleClosed}
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
      <WorkspaceFileViewer
        sessionId={session.id}
        filePath={selectedWorkspaceFile}
        open={selectedWorkspaceFile !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedWorkspaceFile(null);
          }
        }}
        editorBusy={
          codeEditor.state.status === "starting" ||
          codeEditor.state.status === "stopping"
        }
        editorDisabledReason={codeEditorDisabledReason}
        onOpenInEditor={(filePath) => {
          void codeEditor.handleOpenFile(filePath);
        }}
        onAddToPrompt={(filePath, selectedText, comment) => {
          // Build a single snippet with file ref, selected text, and the user's comment
          const parts = [`File: ${filePath}`, "```", selectedText, "```"];
          if (comment) {
            parts.push("", `> ${comment}`);
          }
          const basename = filePath.split("/").pop() ?? filePath;
          addTextAttachment(parts.join("\n"), `comment-on-${basename}`);
          // Focus the input after a brief delay (keep file viewer open)
          setTimeout(() => {
            inputRef.current?.focus();
          }, 100);
        }}
      />
    </>
  );
}
