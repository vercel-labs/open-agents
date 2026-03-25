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

  const content = children ?? workspaceFilePath;

  // Truncate from the left so the filename is always visible:
  // "…components/assistant-file-link.tsx" instead of "apps/web/compone…"
  const chipContent = (
    <span dir="rtl" className="min-w-0 truncate">
      <bdi>{content}</bdi>
    </span>
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
