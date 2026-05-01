"use client";

import { PatchDiff } from "@pierre/diffs/react";
import {
  AlignJustify,
  ChevronRight,
  Columns2,
  Download,
  FileText,
  Loader2,
  RefreshCw,
  SquareDot,
  SquareMinus,
  SquarePlus,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { DiffFile } from "@/app/api/sessions/[sessionId]/diff/route";
import { useGitPanel } from "./git-panel-context";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  type DiffMode,
  useUserPreferences,
} from "@/hooks/use-user-preferences";
import { useIsMobile } from "@/hooks/use-mobile";
import { defaultDiffOptions, splitDiffOptions } from "@/lib/diffs-config";
import { cn } from "@/lib/utils";
import { DownloadDiffDialog } from "./download-diff-dialog";
import { useSessionChatWorkspaceContext } from "./session-chat-context";

type DiffStyle = DiffMode;

const wrappedDiffExtensions = new Set([".md", ".mdx", ".markdown", ".txt"]);

function shouldWrapDiffContent(filePath: string) {
  const normalizedPath = filePath.toLowerCase();
  return [...wrappedDiffExtensions].some((extension) =>
    normalizedPath.endsWith(extension),
  );
}

function formatTimestamp(date: Date) {
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getFilenameFromContentDisposition(header: string | null): string {
  if (!header) return "changes.diff";

  const match = header.match(/filename="([^"]+)"/);
  return match?.[1] ?? "changes.diff";
}

function sanitizeDiffFilename(value: string): string {
  const sanitized = value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return sanitized || "changes";
}

function createDownloadHash(): string {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function createDownloadFilename(value: string): string {
  return `${sanitizeDiffFilename(value)}-${createDownloadHash()}.diff`;
}

function StaleBanner({ cachedAt }: { cachedAt: Date | null }) {
  return (
    <div className="flex items-center gap-2 border-b border-border bg-amber-100 px-4 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
      <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
      <span>
        Viewing cached changes - sandbox is offline
        {cachedAt && (
          <span className="text-amber-700/70 dark:text-amber-400/70">
            {" "}
            (saved {formatTimestamp(cachedAt)})
          </span>
        )}
      </span>
    </div>
  );
}

function FileStatusIcon({ status }: { status: DiffFile["status"] }) {
  if (status === "added") {
    return <SquarePlus className="h-4 w-4 shrink-0 text-green-500" />;
  }
  if (status === "deleted") {
    return <SquareMinus className="h-4 w-4 shrink-0 text-red-500" />;
  }
  // modified + renamed
  return <SquareDot className="h-4 w-4 shrink-0 text-yellow-500" />;
}

function isUncommittedFile(file: DiffFile): boolean {
  return file.stagingStatus === "unstaged" || file.stagingStatus === "partial";
}

/* ------------------------------------------------------------------ */
/* Individual collapsible file diff section                            */
/* ------------------------------------------------------------------ */

function FileDiffSection({
  file,
  isExpanded,
  onToggle,
  diffStyle,
  diffScope,
  sectionRef,
}: {
  file: DiffFile;
  isExpanded: boolean;
  onToggle: () => void;
  diffStyle: DiffStyle;
  diffScope: string;
  sectionRef?: React.Ref<HTMLDivElement>;
}) {
  const baseOptions =
    diffStyle === "split" ? splitDiffOptions : defaultDiffOptions;
  const fileName = file.path.split("/").pop() ?? file.path;
  const dirPath = file.path.slice(0, -fileName.length);

  const isLocalScope = diffScope === "uncommitted";
  const hasLocalChanges =
    file.stagingStatus === "unstaged" || file.stagingStatus === "partial";

  // In local scope, prefer the localDiff (uncommitted changes vs HEAD)
  const patchContent =
    isLocalScope && file.localDiff ? file.localDiff : file.diff;

  return (
    <div ref={sectionRef} className="border-b border-border last:border-b-0">
      {/* Collapsible header */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-accent/50"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
            isExpanded && "rotate-90",
          )}
        />
        <FileStatusIcon status={file.status} />
        <span className="shrink-0 text-xs font-medium text-foreground font-mono">
          {fileName}
        </span>
        {dirPath && (
          <span
            className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-muted-foreground"
            dir="rtl"
          >
            <bdi>{dirPath.replace(/\/$/, "")}</bdi>
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5 text-xs">
          {file.additions > 0 && (
            <span className="text-green-600 dark:text-green-500">
              +{file.additions}
            </span>
          )}
          {file.deletions > 0 && (
            <span className="text-red-600 dark:text-red-400">
              -{file.deletions}
            </span>
          )}
        </div>
      </button>

      {/* Diff content */}
      {isExpanded && (
        <div>
          {isLocalScope && !hasLocalChanges ? (
            <div className="flex flex-col items-center justify-center gap-3 py-6 text-muted-foreground/50">
              <p className="text-sm">No uncommitted changes to display</p>
            </div>
          ) : file.generated ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              Generated file — diff content hidden
            </div>
          ) : patchContent ? (
            <PatchDiff
              key={`${file.path}-${diffStyle}-${diffScope}`}
              patch={patchContent}
              options={
                shouldWrapDiffContent(file.path)
                  ? { ...baseOptions, overflow: "wrap" as const }
                  : baseOptions
              }
            />
          ) : (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              No diff content available
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main DiffTabView — all files inline                                 */
/* ------------------------------------------------------------------ */

/**
 * Shows all changed files inline with collapsible diffs.
 * When a file is clicked in the git panel sidebar, it is expanded and scrolled into view.
 */
export function DiffTabView() {
  const params = useParams<{ sessionId?: string }>();
  const {
    diff,
    diffLoading,
    diffRefreshing,
    diffError,
    diffCachedAt,
    sandboxInfo,
    refreshDiff,
    gitStatus,
  } = useSessionChatWorkspaceContext();
  const { focusedDiffFile, focusedDiffRequestId, diffScope } = useGitPanel();
  const isMobile = useIsMobile();
  const { preferences } = useUserPreferences();
  const [diffStyle, setDiffStyle] = useState<DiffStyle>("unified");
  const [diffDownloading, setDiffDownloading] = useState(false);
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [downloadFilename, setDownloadFilename] = useState<string | null>(null);

  // Track which files are expanded (by path)
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  // Refs for scrolling to specific file sections
  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Filter files based on scope
  const visibleFiles = useMemo(() => {
    if (!diff) return [];
    if (diffScope === "branch") return diff.files;
    return diff.files.filter(isUncommittedFile);
  }, [diff, diffScope]);

  // When a file is requested from the sidebar, expand it and scroll to it.
  useEffect(() => {
    if (!focusedDiffFile) return;

    setExpandedFiles((prev) => {
      if (prev.has(focusedDiffFile)) return prev;
      return new Set([...prev, focusedDiffFile]);
    });

    requestAnimationFrame(() => {
      const el = sectionRefs.current.get(focusedDiffFile);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }, [focusedDiffFile, focusedDiffRequestId]);

  const showStaleIndicator = !sandboxInfo && diff !== null;

  useEffect(() => {
    if (isMobile) {
      setDiffStyle("unified");
      return;
    }
    setDiffStyle(preferences?.defaultDiffMode ?? "unified");
  }, [isMobile, preferences?.defaultDiffMode]);

  const toggleFile = useCallback((filePath: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }, []);

  const setSectionRef = useCallback(
    (filePath: string, el: HTMLDivElement | null) => {
      if (el) {
        sectionRefs.current.set(filePath, el);
      } else {
        sectionRefs.current.delete(filePath);
      }
    },
    [],
  );

  const downloadDiff = useCallback(async () => {
    const sessionId = params.sessionId;
    if (!sessionId) return;

    setDiffDownloading(true);
    try {
      // The server returns one unified diff for the full chat/session changes,
      // including readable untracked files.
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/diff/patch`,
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        const message =
          typeof data?.error === "string"
            ? data.error
            : "Failed to download diff";
        throw new Error(message);
      }

      const blob = await response.blob();
      const filename =
        downloadFilename ??
        getFilenameFromContentDisposition(
          response.headers.get("Content-Disposition"),
        );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success("Diff downloaded");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to download diff",
      );
    } finally {
      setDiffDownloading(false);
    }
  }, [params.sessionId, downloadFilename]);

  const openDownloadDialog = useCallback(() => {
    setDownloadFilename(
      createDownloadFilename(
        gitStatus?.branch ?? sandboxInfo?.currentBranch ?? "changes",
      ),
    );
    setDownloadDialogOpen(true);
  }, [gitStatus?.branch, sandboxInfo?.currentBranch]);

  // Summary stats
  const summaryAdds = visibleFiles.reduce((sum, f) => sum + f.additions, 0);
  const summaryDels = visibleFiles.reduce((sum, f) => sum + f.deletions, 0);
  const hasDownloadableDiff = (diff?.files.length ?? 0) > 0;
  const canDownloadDiff = Boolean(
    params.sessionId && sandboxInfo && hasDownloadableDiff,
  );
  return (
    <div className="flex h-full flex-col">
      <DownloadDiffDialog
        open={downloadDialogOpen}
        onOpenChange={setDownloadDialogOpen}
        onDownload={downloadDiff}
        downloading={diffDownloading}
        canDownload={canDownloadDiff}
        filename={downloadFilename ?? "changes.diff"}
      />
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-medium font-mono">
            {visibleFiles.length} file{visibleFiles.length !== 1 ? "s" : ""}{" "}
            changed
          </span>
          <div className="flex shrink-0 items-center gap-1.5 text-xs">
            {summaryAdds > 0 && (
              <span className="text-green-600 dark:text-green-500">
                +{summaryAdds}
              </span>
            )}
            {summaryDels > 0 && (
              <span className="text-red-600 dark:text-red-400">
                -{summaryDels}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => refreshDiff()}
                disabled={diffRefreshing || !sandboxInfo}
                className="h-7 w-7 px-0"
              >
                <RefreshCw
                  className={cn(
                    "h-3.5 w-3.5",
                    diffRefreshing && "animate-spin",
                  )}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Refresh</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={openDownloadDialog}
                disabled={!canDownloadDiff || diffDownloading}
                className="h-7 w-7 px-0"
                aria-label="Download diff"
              >
                {diffDownloading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Download diff</TooltipContent>
          </Tooltip>
          {/* Expand / Collapse all */}
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setExpandedFiles(new Set(visibleFiles.map((f) => f.path)))
                  }
                  className="h-7 px-1.5 text-xs text-muted-foreground"
                >
                  Expand all
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Expand all files</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setExpandedFiles(new Set())}
                  className="h-7 px-1.5 text-xs text-muted-foreground"
                >
                  Collapse all
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Collapse all files</TooltipContent>
            </Tooltip>
          </div>
          {/* Unified / Split icon toggle */}
          <div className="hidden items-center rounded-md border border-border md:flex">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setDiffStyle("unified")}
                  className={cn(
                    "rounded-l-md p-1.5 transition-colors",
                    diffStyle === "unified"
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <AlignJustify className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Unified</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setDiffStyle("split")}
                  className={cn(
                    "rounded-r-md p-1.5 transition-colors",
                    diffStyle === "split"
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Columns2 className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Split</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      {showStaleIndicator ? <StaleBanner cachedAt={diffCachedAt} /> : null}

      {/* Content */}
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto",
          showStaleIndicator && "opacity-90",
        )}
      >
        {diffLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {diffError && (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-red-600 dark:text-red-400">
              {diffError}
            </p>
          </div>
        )}

        {!diffLoading && !diffError && visibleFiles.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12 text-muted-foreground/50">
            <FileText className="h-8 w-8" />
            <p className="text-sm">
              {diffScope === "uncommitted"
                ? "No uncommitted changes to display"
                : "No file changes yet"}
            </p>
          </div>
        )}

        {!diffLoading &&
          !diffError &&
          visibleFiles.length > 0 &&
          visibleFiles.map((file) => (
            <FileDiffSection
              key={file.path}
              file={file}
              isExpanded={expandedFiles.has(file.path)}
              onToggle={() => toggleFile(file.path)}
              diffStyle={diffStyle}
              diffScope={diffScope}
              sectionRef={(el) => setSectionRef(file.path, el)}
            />
          ))}
      </div>
    </div>
  );
}
