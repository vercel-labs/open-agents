"use client";

import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useOpenFile } from "./open-file-context";

function getFileName(filePath: string): string {
  const parts = filePath.split("/");
  return parts[parts.length - 1] || filePath;
}

export function FileNamePill({
  filePath,
  fullPath,
  error = false,
}: {
  filePath: string;
  fullPath?: string;
  error?: boolean;
}) {
  const onOpenFile = useOpenFile();
  const fileName = getFileName(filePath);
  const tooltipPath = fullPath ?? filePath;
  const showTooltip = tooltipPath !== fileName;
  const isClickable = onOpenFile !== null;

  const handleClick = (e: React.MouseEvent) => {
    if (!onOpenFile) return;
    e.stopPropagation(); // Don't trigger parent tool call expand
    onOpenFile(filePath);
  };

  const errorStyles = error
    ? "border-red-500/30 bg-red-500/10 text-red-400"
    : "";
  const normalStyles = error
    ? ""
    : "border-border/80 bg-muted/60 text-muted-foreground";
  const hoverStyles = error
    ? "hover:border-red-500/40 hover:bg-red-500/15"
    : "hover:border-foreground/20 hover:bg-muted hover:shadow-sm hover:ring-1 hover:ring-foreground/5";

  const pill = isClickable ? (
    <button
      type="button"
      onClick={handleClick}
      title={showTooltip ? undefined : `Open ${fileName}`}
      className={cn(
        "inline-flex max-w-[220px] cursor-pointer items-center rounded border px-1.5 py-0.5 font-mono text-[12px] leading-tight transition-all",
        normalStyles,
        errorStyles,
        hoverStyles,
      )}
    >
      <span className="truncate">{fileName}</span>
    </button>
  ) : (
    <span
      className={cn(
        "inline-flex max-w-[220px] items-center rounded border px-1.5 py-0.5 font-mono text-[12px] leading-tight",
        normalStyles,
        errorStyles,
      )}
    >
      <span className="truncate">{fileName}</span>
    </span>
  );

  if (!showTooltip) return pill;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{pill}</TooltipTrigger>
      <TooltipContent side="top">
        <span className="font-mono text-xs">{tooltipPath}</span>
      </TooltipContent>
    </Tooltip>
  );
}
