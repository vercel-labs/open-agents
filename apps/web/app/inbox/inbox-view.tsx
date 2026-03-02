"use client";

import type {
  AttentionState,
  InboxDiff,
  InboxDiffFile,
  InboxItem,
} from "@/app/api/inbox/route";
import { DiffsProvider } from "@/components/diffs-provider";
import { useInbox } from "@/hooks/use-inbox";
import { useInboxMessages } from "@/hooks/use-inbox-messages";
import { useSession } from "@/hooks/use-session";
import { defaultDiffOptions } from "@/lib/diffs-config";
import { streamdownPlugins } from "@/lib/streamdown-config";
import { cn } from "@/lib/utils";
import { PatchDiff } from "@pierre/diffs/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertCircle,
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Eye,
  FileText,
  GitCompare,
  GitPullRequest,
  Loader2,
  MessageSquareWarning,
  Plus,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";
import "streamdown/styles.css";

const Streamdown = dynamic(
  () => import("streamdown").then((m) => m.Streamdown),
  { ssr: false },
);

type FilterTab = "all" | "needs_input" | "needs_review" | "working";

const FILTER_LABELS: Record<FilterTab, string> = {
  all: "All",
  needs_input: "Needs input",
  needs_review: "Needs review",
  working: "Working",
};

// -- Shared components --

function AttentionBadge({ state }: { state: AttentionState }) {
  switch (state) {
    case "needs_input":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-500">
          <MessageSquareWarning className="h-3 w-3" />
          Needs input
        </span>
      );
    case "needs_review":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-500">
          <Eye className="h-3 w-3" />
          Review
        </span>
      );
    case "working":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Working
        </span>
      );
    case "idle":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          Idle
        </span>
      );
  }
}

function DiffStats({
  added,
  removed,
}: {
  added: number | null;
  removed: number | null;
}) {
  if (added === null && removed === null) return null;
  if (added === 0 && removed === 0) return null;

  return (
    <span className="font-mono text-xs">
      {added !== null && added > 0 ? (
        <span className="text-green-500">+{added}</span>
      ) : null}
      {added !== null && added > 0 && removed !== null && removed > 0 ? (
        <span className="text-muted-foreground/40">/</span>
      ) : null}
      {removed !== null && removed > 0 ? (
        <span className="text-red-400">-{removed}</span>
      ) : null}
    </span>
  );
}

function TodoProgress({ todos }: { todos: InboxItem["latestTodos"] }) {
  if (!todos || todos.length === 0) return null;

  const completed = todos.filter((t) => t.status === "completed").length;
  const inProgress = todos.find((t) => t.status === "in_progress");
  const total = todos.length;

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <div className="flex items-center gap-1">
        <span className="tabular-nums">
          {completed}/{total}
        </span>
      </div>
      {inProgress ? (
        <span className="truncate text-foreground/70">
          → {inProgress.content}
        </span>
      ) : null}
    </div>
  );
}

// -- Inline diff file list (collapsed by default) --

function DiffStatusBadge({ status }: { status: InboxDiffFile["status"] }) {
  const styles = {
    added: "bg-green-500/20 text-green-400",
    modified: "bg-blue-500/20 text-blue-400",
    deleted: "bg-red-500/20 text-red-400",
    renamed: "bg-yellow-500/20 text-yellow-400",
  };

  const labels = {
    added: "New",
    modified: "Modified",
    deleted: "Deleted",
    renamed: "Renamed",
  };

  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
        styles[status],
      )}
    >
      {labels[status]}
    </span>
  );
}

function StagingBadge({
  stagingStatus,
}: {
  stagingStatus: InboxDiffFile["stagingStatus"];
}) {
  if (!stagingStatus || stagingStatus === "staged") return null;

  const styles = {
    unstaged: "bg-orange-500/20 text-orange-400",
    partial: "bg-purple-500/20 text-purple-400",
  };

  const labels = {
    unstaged: "Unstaged",
    partial: "Partial",
  };

  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
        styles[stagingStatus],
      )}
    >
      {labels[stagingStatus]}
    </span>
  );
}

function InlineDiffFileEntry({
  file,
  isExpanded,
  onToggle,
}: {
  file: InboxDiffFile;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const fileName = file.path.split("/").pop() ?? file.path;
  const dirPath = file.path.slice(0, -fileName.length);
  const isGenerated = file.generated === true;

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={isGenerated ? undefined : onToggle}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left",
          isGenerated ? "cursor-default opacity-70" : "hover:bg-muted/50",
        )}
      >
        {isGenerated ? (
          <span className="h-4 w-4 shrink-0" />
        ) : isExpanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm">
            {dirPath && (
              <span className="text-muted-foreground">{dirPath}</span>
            )}
            <span className="font-medium text-foreground">{fileName}</span>
          </span>
          <DiffStatusBadge status={file.status} />
          <StagingBadge stagingStatus={file.stagingStatus} />
          {isGenerated && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
              Generated
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs">
          {file.additions > 0 && (
            <span className="text-green-500">+{file.additions}</span>
          )}
          {file.deletions > 0 && (
            <span className="text-red-400">-{file.deletions}</span>
          )}
        </div>
      </button>

      {isExpanded && !isGenerated && (
        <div className="border-t border-border">
          {file.diff ? (
            <PatchDiff patch={file.diff} options={defaultDiffOptions} />
          ) : (
            <div className="px-4 py-3 text-xs text-muted-foreground">
              No diff content available
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InlineDiffViewer({ diff }: { diff: InboxDiff }) {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const toggleFile = (path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  if (diff.files.length === 0) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="mb-2 flex w-full items-center gap-2 text-left"
      >
        {isOpen ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Changes
        </h3>
        <span className="text-xs text-muted-foreground">
          {diff.summary.totalFiles} file
          {diff.summary.totalFiles !== 1 && "s"}
        </span>
        <div className="flex items-center gap-1.5 font-mono text-xs">
          {diff.summary.totalAdditions > 0 && (
            <span className="text-green-500">
              +{diff.summary.totalAdditions}
            </span>
          )}
          {diff.summary.totalDeletions > 0 && (
            <span className="text-red-400">-{diff.summary.totalDeletions}</span>
          )}
        </div>
      </button>

      {isOpen && (
        <div className="rounded-lg border border-border">
          {diff.files.map((file) => (
            <InlineDiffFileEntry
              key={file.path}
              file={file}
              isExpanded={expandedFiles.has(file.path)}
              onToggle={() => toggleFile(file.path)}
            />
          ))}
          {diff.baseRef && (
            <div className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
              vs{" "}
              <span className="font-mono text-foreground/70">
                {diff.baseRef}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// -- Inbox item list row --

function InboxItemRow({
  item,
  isSelected,
  onSelect,
  onNavigate,
}: {
  item: InboxItem;
  isSelected: boolean;
  onSelect: () => void;
  onNavigate: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={onNavigate}
      className={cn(
        "group flex w-full flex-col gap-1 rounded-lg px-4 py-3 text-left transition-colors",
        isSelected ? "bg-secondary" : "hover:bg-muted/50",
      )}
    >
      {/* Row 1: Badge + Title + Repo + Diff stats */}
      <div className="flex items-center gap-3">
        <AttentionBadge state={item.attentionState} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {item.sessionTitle}
        </span>
        <div className="flex shrink-0 items-center gap-3">
          {item.repoName ? (
            <span className="text-xs text-muted-foreground">
              {item.repoName}
            </span>
          ) : null}
          <DiffStats added={item.linesAdded} removed={item.linesRemoved} />
        </div>
      </div>

      {/* Row 2: Objective (what was asked) */}
      {item.objective ? (
        <p className="truncate pl-0 text-xs text-muted-foreground">
          {item.objective}
        </p>
      ) : null}

      {/* Row 3: Todo progress (if working or has todos) */}
      {item.latestTodos && item.latestTodos.length > 0 ? (
        <div className="pl-0">
          <TodoProgress todos={item.latestTodos} />
        </div>
      ) : null}
    </button>
  );
}

// -- Email-style thread: older messages collapsed, last exchange expanded --

function ThreadView({
  thread,
  threadEndRef,
}: {
  thread: { id: string; role: string; text: string; createdAt: string }[];
  threadEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Find the index where the last "exchange" starts.
  // Walk backwards: the last assistant message and the user message before it.
  const lastExchangeStart = (() => {
    let lastAssistantIdx = -1;
    for (let i = thread.length - 1; i >= 0; i--) {
      if (thread[i]?.role === "assistant") {
        lastAssistantIdx = i;
        break;
      }
    }
    if (lastAssistantIdx === -1) return Math.max(0, thread.length - 1);
    // Include the user message right before it
    if (lastAssistantIdx > 0 && thread[lastAssistantIdx - 1]?.role === "user") {
      return lastAssistantIdx - 1;
    }
    return lastAssistantIdx;
  })();

  const olderMessages = thread.slice(0, lastExchangeStart);
  const latestMessages = thread.slice(lastExchangeStart);

  const toggleMessage = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="space-y-2">
      {/* Older messages — collapsed by default */}
      {olderMessages.map((msg) => {
        const isExpanded = expandedIds.has(msg.id);
        const preview =
          msg.text.length > 100 ? `${msg.text.slice(0, 100)}…` : msg.text;

        return (
          <button
            key={msg.id}
            type="button"
            onClick={() => toggleMessage(msg.id)}
            className="flex w-full items-start gap-3 rounded-lg border border-border px-4 py-3 text-left transition-colors hover:bg-muted/30"
          >
            <ChevronRight
              className={cn(
                "mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                isExpanded && "rotate-90",
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {msg.role === "user" ? "You" : "Agent"}
                </span>
                <span className="text-xs text-muted-foreground/50">
                  {new Date(msg.createdAt).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              {isExpanded ? (
                <div className="mt-2 min-w-0 overflow-hidden">
                  {msg.role === "user" ? (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                      {msg.text}
                    </p>
                  ) : (
                    <Streamdown
                      mode="static"
                      isAnimating={false}
                      plugins={streamdownPlugins}
                    >
                      {msg.text}
                    </Streamdown>
                  )}
                </div>
              ) : (
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {preview}
                </p>
              )}
            </div>
          </button>
        );
      })}

      {/* Separator if there are older messages */}
      {olderMessages.length > 0 && latestMessages.length > 0 ? (
        <div className="flex items-center gap-3 py-1">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground/50">Latest</span>
          <div className="h-px flex-1 bg-border" />
        </div>
      ) : null}

      {/* Latest exchange — always expanded */}
      {latestMessages.map((msg) => (
        <div key={msg.id} className="py-1">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {msg.role === "user" ? "You" : "Agent"}
            </span>
            <span className="text-xs text-muted-foreground/50">
              {new Date(msg.createdAt).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          </div>
          {msg.role === "user" ? (
            <div className="rounded-lg bg-primary/5 px-4 py-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {msg.text}
              </p>
            </div>
          ) : (
            <div className="min-w-0 overflow-hidden pl-0.5">
              <Streamdown
                mode="static"
                isAnimating={false}
                plugins={streamdownPlugins}
              >
                {msg.text}
              </Streamdown>
            </div>
          )}
        </div>
      ))}
      <div ref={threadEndRef} />
    </div>
  );
}

// -- Detail panel --

function InboxItemDetail({
  item,
  onNavigate,
  onSent,
}: {
  item: InboxItem;
  onNavigate: () => void;
  onSent: () => void;
}) {
  const {
    thread,
    rawMessages,
    refresh: refreshMessages,
  } = useInboxMessages(item.chatId);
  const [replyText, setReplyText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  // Reset reply state when switching items
  useEffect(() => {
    setReplyText("");
    setIsSending(false);
    setSendError(null);
    setShowDiff(false);
  }, [item.sessionId]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0";
    const newHeight = Math.min(textarea.scrollHeight, 120);
    textarea.style.height = `${newHeight}px`;
  }, [replyText]);

  // Scroll to bottom when thread updates
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread.length]);

  const handleSendReply = useCallback(async () => {
    const trimmed = replyText.trim();
    if (!trimmed || !item.chatId || isSending) return;

    setIsSending(true);
    setSendError(null);

    try {
      // Build the new user message in AI SDK UIMessage format
      const newUserMessage = {
        id: nanoid(),
        role: "user" as const,
        parts: [{ type: "text" as const, text: trimmed }],
      };

      // Append to existing raw messages and POST to the chat API
      const allMessages = [...rawMessages, newUserMessage];

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: allMessages,
          sessionId: item.sessionId,
          chatId: item.chatId,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const errorMsg =
          data?.error === "Sandbox not initialized"
            ? "Sandbox is hibernated. Open the session to wake it up."
            : (data?.error ?? `Failed to send (${res.status})`);
        setSendError(errorMsg);
        setIsSending(false);
        return;
      }

      // Fire and forget — we don't need to consume the stream.
      // The server will process the message and update the session state.
      // We intentionally do NOT await the response body.
      setReplyText("");
      setIsSending(false);

      // Refresh messages and signal the parent to refresh inbox
      refreshMessages();
      onSent();
    } catch {
      setSendError("Network error. Please try again.");
      setIsSending(false);
    }
  }, [
    replyText,
    item.chatId,
    item.sessionId,
    isSending,
    rawMessages,
    refreshMessages,
    onSent,
  ]);

  const hasDiff =
    item.cachedDiff &&
    item.cachedDiff.files &&
    item.cachedDiff.files.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* Detail header with session actions */}
      <div className="shrink-0 border-b border-border px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AttentionBadge state={item.attentionState} />
            <h2 className="text-base font-semibold">{item.sessionTitle}</h2>
            {item.repoName ? (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-sm text-muted-foreground">
                  {item.repoOwner}/{item.repoName}
                </span>
              </>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5">
            {/* Diff toggle */}
            {hasDiff ? (
              <button
                type="button"
                onClick={() => setShowDiff(!showDiff)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                  showDiff
                    ? "border-blue-500/30 bg-blue-500/10 text-blue-500"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                <GitCompare className="h-3.5 w-3.5" />
                Changes
                <DiffStats
                  added={item.linesAdded}
                  removed={item.linesRemoved}
                />
              </button>
            ) : null}
            {/* PR: view existing or create new */}
            {item.prNumber && item.repoOwner && item.repoName ? (
              <Link
                href={`https://github.com/${item.repoOwner}/${item.repoName}/pull/${item.prNumber}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <GitPullRequest className="h-3.5 w-3.5" />
                PR #{item.prNumber}
                <ExternalLink className="h-3 w-3" />
              </Link>
            ) : hasDiff ? (
              <button
                type="button"
                onClick={onNavigate}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                Create PR
              </button>
            ) : null}
            {/* Open session */}
            <button
              type="button"
              onClick={onNavigate}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Open session
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Thread view — older messages collapsed, last exchange expanded */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-5">
          {thread.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              No messages yet
            </div>
          ) : (
            <ThreadView thread={thread} threadEndRef={threadEndRef} />
          )}
        </div>
      </div>

      {/* Diff dialog (modal) */}
      {hasDiff && item.cachedDiff ? (
        <Dialog open={showDiff} onOpenChange={setShowDiff}>
          <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Changes</DialogTitle>
            </DialogHeader>
            <InlineDiffViewer diff={item.cachedDiff} />
          </DialogContent>
        </Dialog>
      ) : null}

      {/* Reply input */}
      {item.chatId ? (
        <div className="shrink-0 border-t border-border px-6 py-3">
          {sendError ? (
            <div className="mb-2 flex items-center gap-2 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {sendError}
              <button
                type="button"
                onClick={() => setSendError(null)}
                className="ml-auto text-red-400/70 hover:text-red-400"
              >
                Dismiss
              </button>
            </div>
          ) : null}
          <div className="relative flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendReply();
                }
              }}
              placeholder="Reply to this session..."
              rows={1}
              disabled={isSending}
              className="min-h-[38px] flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleSendReply}
              disabled={!replyText.trim() || isSending}
              className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40 disabled:hover:bg-primary"
            >
              {isSending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// -- Supporting components --

function InboxSkeleton() {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="space-y-2 rounded-lg px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="h-5 w-20 animate-pulse rounded-full bg-muted" />
            <div className="h-4 w-48 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-3 w-64 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function EmptyInbox({ filter }: { filter: FilterTab }) {
  if (filter !== "all") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">
            No sessions {FILTER_LABELS[filter].toLowerCase()}
          </p>
          <p className="mt-1 text-sm text-muted-foreground/60">
            Sessions matching this filter will appear here
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="text-center">
        <p className="text-muted-foreground">Inbox zero</p>
        <p className="mt-1 text-sm text-muted-foreground/60">
          No active sessions. Start one from the{" "}
          <Link href="/" className="underline underline-offset-4">
            home page
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

// -- Main inbox view --

export function InboxView() {
  const router = useRouter();
  const { isAuthenticated, loading: sessionLoading } = useSession();
  const {
    items,
    loading,
    actionableCount,
    needsInputCount,
    needsReviewCount,
    workingCount,
    refresh: refreshInbox,
  } = useInbox({ enabled: isAuthenticated });
  const [filter, setFilter] = useState<FilterTab>("all");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filteredItems =
    filter === "all" ? items : items.filter((i) => i.attentionState === filter);

  // Clamp selection
  useEffect(() => {
    if (selectedIndex >= filteredItems.length && filteredItems.length > 0) {
      setSelectedIndex(filteredItems.length - 1);
    }
  }, [filteredItems.length, selectedIndex]);

  const selectedItem = filteredItems[selectedIndex] ?? null;

  const navigateToSession = useCallback(
    (sessionId: string) => {
      router.push(`/sessions/${sessionId}`);
    },
    [router],
  );

  // After sending a reply, refresh the inbox. The item will move to "Working"
  // and (if filtered) disappear from the current view, advancing to the next.
  const handleSent = useCallback(() => {
    // Small delay to let the server catch up
    setTimeout(() => {
      refreshInbox();
    }, 1500);
  }, [refreshInbox]);

  // Keyboard navigation (j/k or arrow keys, enter to open)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture if user is in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          Math.min(prev + 1, filteredItems.length - 1),
        );
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && selectedItem) {
        e.preventDefault();
        navigateToSession(selectedItem.sessionId);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filteredItems.length, selectedItem, navigateToSession]);

  if (sessionLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    router.replace("/");
    return null;
  }

  return (
    <DiffsProvider>
      <div className="flex h-dvh flex-col bg-background text-foreground">
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between border-b border-border px-6 py-3">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Home
            </Link>
            <div className="h-4 w-px bg-border" />
            <h1 className="text-lg font-semibold">Inbox</h1>
            {actionableCount > 0 ? (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500/15 px-1.5 text-xs font-medium tabular-nums text-amber-500">
                {actionableCount}
              </span>
            ) : null}
          </div>
          <div className="text-xs text-muted-foreground">
            <kbd className="rounded border border-border px-1.5 py-0.5 font-mono">
              j
            </kbd>
            <kbd className="ml-0.5 rounded border border-border px-1.5 py-0.5 font-mono">
              k
            </kbd>{" "}
            navigate ·{" "}
            <kbd className="rounded border border-border px-1.5 py-0.5 font-mono">
              ↵
            </kbd>{" "}
            open
          </div>
        </header>

        {/* Filter tabs */}
        <div className="flex shrink-0 items-center gap-1 border-b border-border px-6 py-2">
          {(
            [
              { key: "all" as const, count: items.length },
              { key: "needs_input" as const, count: needsInputCount },
              { key: "needs_review" as const, count: needsReviewCount },
              { key: "working" as const, count: workingCount },
            ] as const
          ).map(({ key, count }) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setFilter(key);
                setSelectedIndex(0);
              }}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                filter === key
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {FILTER_LABELS[key]}
              {count > 0 ? (
                <span className="ml-1.5 tabular-nums text-muted-foreground">
                  {count}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {/* Main content: list + detail split view */}
        <div className="flex min-h-0 flex-1">
          {/* List panel */}
          <div
            ref={listRef}
            className="w-full min-w-0 overflow-y-auto border-r border-border md:w-[420px] md:shrink-0"
          >
            {loading ? (
              <InboxSkeleton />
            ) : filteredItems.length === 0 ? (
              <EmptyInbox filter={filter} />
            ) : (
              <div className="p-2">
                {filteredItems.map((item, index) => (
                  <InboxItemRow
                    key={item.sessionId}
                    item={item}
                    isSelected={index === selectedIndex}
                    onSelect={() => setSelectedIndex(index)}
                    onNavigate={() => navigateToSession(item.sessionId)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Detail panel (hidden on mobile) */}
          <div className="hidden flex-1 md:block">
            {selectedItem ? (
              <InboxItemDetail
                item={selectedItem}
                onNavigate={() => navigateToSession(selectedItem.sessionId)}
                onSent={handleSent}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Select a session to view details
              </div>
            )}
          </div>
        </div>
      </div>
    </DiffsProvider>
  );
}
