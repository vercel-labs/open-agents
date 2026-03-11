"use client";

import type { ToolRenderState } from "@open-harness/shared/lib/tool-state";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import type React from "react";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";
import { ApprovalButtons } from "./approval-buttons";

export type ToolLayoutProps = {
  name: string;
  summary: string;
  summaryClassName?: string;
  meta?: ReactNode;
  state: ToolRenderState;
  output?: ReactNode;
  children?: ReactNode;
  expandedContent?: ReactNode;
  onApprove?: (id: string) => void;
  onDeny?: (id: string, reason?: string) => void;
  defaultExpanded?: boolean;
  indicator?: ReactNode;
  nameClassName?: string;
};

function StatusIndicator({ state }: { state: ToolRenderState }) {
  if (state.interrupted) {
    return (
      <span className="inline-block h-2 w-2 rounded-full border border-yellow-500" />
    );
  }

  if (state.running) {
    return <Loader2 className="h-3 w-3 animate-spin text-yellow-500" />;
  }

  const color = state.denied
    ? "bg-red-500"
    : state.approvalRequested
      ? "bg-yellow-500"
      : state.error
        ? "bg-red-500"
        : "bg-green-500";

  return <span className={cn("inline-block h-2 w-2 rounded-full", color)} />;
}

function hasRenderableContent(value: ReactNode) {
  return (
    value !== null && value !== undefined && value !== false && value !== ""
  );
}

export function ToolLayout({
  name,
  summary,
  summaryClassName,
  meta,
  state,
  output,
  children,
  expandedContent,
  onApprove,
  onDeny,
  defaultExpanded = false,
  indicator,
  nameClassName,
}: ToolLayoutProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const showApprovalButtons = Boolean(
    state.approvalRequested && !state.isActiveApproval && state.approvalId,
  );
  const hasExpandedDetails = hasRenderableContent(expandedContent);
  const hasOutput = hasRenderableContent(output);
  const hasChildren = hasRenderableContent(children);
  const hasMeta = hasRenderableContent(meta);
  const hasSummary = summary.trim().length > 0;
  const showRunningNotice =
    state.approvalRequested && !showApprovalButtons && !state.interrupted;
  const interruptedBadge = state.interrupted ? (
    <span className="inline-flex items-center rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-[11px] font-medium leading-none text-yellow-600 dark:text-yellow-400">
      Interrupted
    </span>
  ) : null;
  const hasTrailingMeta = hasMeta || interruptedBadge !== null;

  const isCompact =
    !isExpanded &&
    !showRunningNotice &&
    !showApprovalButtons &&
    !hasOutput &&
    !state.denied &&
    !state.error &&
    !hasChildren;

  const handleToggle = () => {
    if (hasExpandedDetails) {
      setIsExpanded((prev) => !prev);
    }
  };

  const headerIndicator = indicator ?? <StatusIndicator state={state} />;

  return (
    <div
      className={cn(
        "my-1.5 transition-[background-color,border-color,padding] duration-150",
        isCompact
          ? "rounded-md border border-transparent bg-transparent py-0.5"
          : "overflow-hidden rounded-lg border border-border/60 bg-card/60 p-3",
      )}
    >
      <div
        className={cn(
          "flex min-w-0 select-none items-baseline gap-2 rounded-md text-sm",
          hasExpandedDetails && "cursor-pointer",
          isCompact && "py-0.5 pr-1",
          isCompact &&
            hasExpandedDetails &&
            "transition-colors hover:bg-muted/50",
        )}
        {...(hasExpandedDetails && {
          onClick: handleToggle,
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleToggle();
            }
          },
          role: "button",
          tabIndex: 0,
          "aria-expanded": isExpanded,
        })}
      >
        <span
          className={cn(
            "flex size-3.5 shrink-0 items-center self-center",
            isCompact ? "justify-start" : "justify-center",
          )}
        >
          {headerIndicator}
        </span>
        <span
          className={cn(
            "shrink-0 font-medium leading-none",
            state.denied ? "text-red-500" : "text-foreground",
            nameClassName,
          )}
        >
          {name}
        </span>

        <div className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
          {hasSummary && (
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[13px] leading-none text-muted-foreground",
                summaryClassName,
              )}
            >
              {summary}
            </span>
          )}

          {hasTrailingMeta && (
            <span className="inline-flex shrink-0 items-center gap-1.5 text-[13px] leading-none text-muted-foreground">
              {meta}
              {interruptedBadge}
            </span>
          )}
        </div>

        {hasExpandedDetails && (
          <span className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center self-center text-muted-foreground/70">
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </span>
        )}
      </div>

      {children}

      {showRunningNotice && (
        <div className="mt-2 pl-5 text-sm text-muted-foreground">
          Running...
        </div>
      )}

      {showApprovalButtons && (
        <div
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          role="presentation"
        >
          <ApprovalButtons
            approvalId={state.approvalId!}
            onApprove={onApprove}
            onDeny={onDeny}
          />
        </div>
      )}

      {hasOutput &&
        !state.approvalRequested &&
        !state.denied &&
        !state.interrupted && (
          <div className="mt-2 pl-5 text-sm text-muted-foreground">
            {output}
          </div>
        )}

      {state.denied && (
        <div className="mt-2 pl-5 text-sm text-red-500">
          Denied{state.denialReason ? `: ${state.denialReason}` : ""}
        </div>
      )}

      {state.error && !state.denied && (
        <div className="mt-2 pl-5 text-sm text-red-500">
          Error: {state.error.slice(0, 80)}
        </div>
      )}

      {isExpanded && hasExpandedDetails && (
        <div className="mt-3 border-t border-border pt-3">
          {expandedContent}
        </div>
      )}
    </div>
  );
}
