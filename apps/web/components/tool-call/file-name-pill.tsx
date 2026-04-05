"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function getFileName(filePath: string): string {
  const parts = filePath.split("/");
  return parts[parts.length - 1] || filePath;
}

export function FileNamePill({
  filePath,
  fullPath,
}: {
  filePath: string;
  fullPath?: string;
}) {
  const fileName = getFileName(filePath);
  const tooltipPath = fullPath ?? filePath;
  const showTooltip = tooltipPath !== fileName;

  const pill = (
    <span className="inline-flex max-w-[220px] items-center rounded border border-border/80 bg-muted/60 px-1.5 py-0.5 font-mono text-[12px] leading-tight text-muted-foreground">
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
