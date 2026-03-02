"use client";

import type {
  AttentionState,
  InboxDiff,
  InboxDiffFile,
  InboxItem,
} from "@/app/api/inbox/route";
import { DiffsProvider } from "@/components/diffs-provider";
import { useInbox } from "@/hooks/use-inbox";
import { useSession } from "@/hooks/use-session";
import { defaultDiffOptions } from "@/lib/diffs-config";
import { cn } from "@/lib/utils";
import { PatchDiff } from "@pierre/diffs/react";
import {
  ArrowLeft,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Circle,
  Eye,
  FileText,
  Loader2,
  MessageSquareWarning,
  Square,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type FilterTab = "all" | "needs_input" | "needs_review" | "working";

const FILTER_LABELS: Record<FilterTab, string> = {
  all: "All",
  needs_input: "Needs input",
  needs_review: "Needs review",
  working: "Working",
};

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

// -- Inbox item components --

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

function InboxItemDetail({
  item,
  onNavigate,
}: {
  item: InboxItem;
  onNavigate: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      {/* Detail header */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AttentionBadge state={item.attentionState} />
            <h2 className="text-lg font-semibold">{item.sessionTitle}</h2>
          </div>
          <button
            type="button"
            onClick={onNavigate}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Open session
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        {item.repoName ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {item.repoOwner}/{item.repoName}
          </p>
        ) : null}
      </div>

      {/* Detail body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="space-y-6">
          {/* Objective */}
          {item.objective ? (
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Objective
              </h3>
              <p className="text-sm leading-relaxed text-foreground">
                {item.objective}
              </p>
            </div>
          ) : null}

          {/* Status / Todos */}
          {item.latestTodos && item.latestTodos.length > 0 ? (
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Progress
              </h3>
              <div className="space-y-1.5">
                {item.latestTodos.map((todo) => (
                  <div key={todo.id} className="flex items-center gap-2">
                    {todo.status === "completed" ? (
                      <CheckSquare className="h-4 w-4 shrink-0 text-green-500" />
                    ) : todo.status === "in_progress" ? (
                      <Circle className="h-4 w-4 shrink-0 fill-amber-500 text-amber-500" />
                    ) : (
                      <Square className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span
                      className={cn(
                        "text-sm",
                        todo.status === "completed"
                          ? "text-muted-foreground line-through"
                          : todo.status === "in_progress"
                            ? "text-amber-500"
                            : "text-foreground",
                      )}
                    >
                      {todo.content}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Agent response (shown first before diff) */}
          {item.latestResponse ? (
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Agent response
              </h3>
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                  {item.latestResponse.length > 800
                    ? `${item.latestResponse.slice(0, 800)}…`
                    : item.latestResponse}
                </p>
              </div>
            </div>
          ) : null}

          {/* Diff viewer (collapsed by default) */}
          {item.cachedDiff &&
          item.cachedDiff.files &&
          item.cachedDiff.files.length > 0 ? (
            <InlineDiffViewer diff={item.cachedDiff} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

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
