"use client";

import { FileText } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";
import { parseWorkspaceFileHref } from "@/lib/assistant-file-links";
import { cn } from "@/lib/utils";

type StreamdownAnchorProps = ComponentPropsWithoutRef<"a"> & {
  node?: unknown;
};

export type AssistantFileLinkProps = StreamdownAnchorProps & {
  onOpenFile?: (filePath: string) => void;
};

const fileChipClassName =
  "inline-flex max-w-full items-center gap-1 rounded-md border border-border/60 bg-muted/60 px-1.5 py-0.5 font-mono text-[0.9em] leading-none text-foreground no-underline";

/**
 * Extract the filename from a path string, returning the last segment.
 * Falls back to the full string if there are no separators.
 */
function getFileName(filePath: string): string {
  const lastSlash = filePath.lastIndexOf("/");
  if (lastSlash === -1) {
    return filePath;
  }
  return filePath.slice(lastSlash + 1);
}

/**
 * Get the directory portion of a path (everything before the last segment).
 * Returns null if there is no directory prefix.
 */
function getDirPath(filePath: string): string | null {
  const lastSlash = filePath.lastIndexOf("/");
  if (lastSlash === -1) {
    return null;
  }
  return filePath.slice(0, lastSlash + 1);
}

export function AssistantFileLink({
  children,
  className,
  href,
  onOpenFile,
  node: _node,
  ...anchorProps
}: AssistantFileLinkProps) {
  const workspaceFilePath = parseWorkspaceFileHref(href);
  if (!workspaceFilePath) {
    return (
      <a href={href} className={className} {...anchorProps}>
        {children}
      </a>
    );
  }

  // If the link has custom children that differ from the raw path, render them
  // as-is (truncated). Otherwise show dir + filename with smarter overflow.
  const hasCustomContent =
    children != null && children !== workspaceFilePath;

  const fileName = getFileName(workspaceFilePath);
  const dirPath = getDirPath(workspaceFilePath);

  const chipContent = hasCustomContent ? (
    <span className="min-w-0 truncate">{children}</span>
  ) : (
    <>
      {dirPath && (
        <span className="min-w-0 shrink truncate text-muted-foreground">
          {dirPath}
        </span>
      )}
      <span className="shrink-0">{fileName}</span>
    </>
  );

  if (!onOpenFile) {
    return (
      <span
        className={cn(fileChipClassName, "cursor-default", className)}
        title={workspaceFilePath}
      >
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        {chipContent}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={cn(
        fileChipClassName,
        "cursor-pointer transition-colors hover:border-foreground/20 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
      onClick={() => onOpenFile(workspaceFilePath)}
      title={`Open ${workspaceFilePath}`}
    >
      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      {chipContent}
    </button>
  );
}
