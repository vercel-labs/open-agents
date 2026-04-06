"use client";

import type { ToolRenderState } from "@open-harness/shared/lib/tool-state";
import { CircleX, Loader2, Minus, Plus } from "lucide-react";
import type React from "react";
import { type ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { ApprovalButtons } from "./approval-buttons";

export type ToolLayoutProps = {
  name: string;
  summary: ReactNode;
  summaryClassName?: string;
  meta?: ReactNode;
  /** When true, push meta to the far right of the header row. */
  rightAlignMeta?: boolean;
  /** Short label shown right-aligned in the error header (e.g. "exit 1"). */
  errorMeta?: ReactNode;
  state: ToolRenderState;
  output?: ReactNode;
  children?: ReactNode;
  expandedContent?: ReactNode;
  onApprove?: (id: string) => void;
  onDeny?: (id: string, reason?: string) => void;
  defaultExpanded?: boolean;
  /** Tool-specific icon (Lucide element). */
  icon?: ReactNode;
  /** @deprecated Use `icon` instead. */
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

const EXPANDED_CONTENT_TRANSITION_MS = 200;

function trimErrorPrefix(message: string) {
  return message.replace(/^Error:\s*/i, "").trim();
}

export function ToolLayout({
  name,
  summary,
  summaryClassName,
  meta,
  rightAlignMeta = false,
  errorMeta,
  state,
  output,
  children,
  expandedContent,
  onApprove,
  onDeny,
  defaultExpanded = false,
  icon,
  indicator,
  nameClassName,
}: ToolLayoutProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const showApprovalButtons = Boolean(
    state.approvalRequested && !state.isActiveApproval && state.approvalId,
  );
  const errorMessage =
    state.error && !state.denied ? trimErrorPrefix(state.error) : undefined;
  const hasError = Boolean(errorMessage);
  const hasExpandedDetails = hasRenderableContent(expandedContent) || hasError;
  const hasOutput = hasRenderableContent(output);
  const hasMeta = hasRenderableContent(meta);
  const hasSummary =
    typeof summary === "string" ? summary.trim().length > 0 : summary != null;
  const showRunningNotice =
    state.approvalRequested && !showApprovalButtons && !state.interrupted;
  const interruptedBadge = state.interrupted ? (
    <span className="inline-flex items-center rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-[11px] font-medium leading-none text-yellow-600 dark:text-yellow-400">
      Interrupted
    </span>
  ) : null;
  const isExpandedPanelVisible = isExpanded && hasExpandedDetails;
  const [shouldRenderExpandedContent, setShouldRenderExpandedContent] =
    useState(defaultExpanded && hasExpandedDetails);

  // Error state flags
  const showErrorHeader = hasError;
  const showErrorExpanded = hasError && isExpandedPanelVisible;
  const hasErrorMeta = hasRenderableContent(errorMeta);
  const hasTrailingMeta =
    !showErrorHeader && (hasMeta || interruptedBadge !== null);

  useEffect(() => {
    if (!hasExpandedDetails) {
      setShouldRenderExpandedContent(false);
      return;
    }

    if (isExpandedPanelVisible) {
      setShouldRenderExpandedContent(true);
      return;
    }

    if (!shouldRenderExpandedContent) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setShouldRenderExpandedContent(false);
    }, EXPANDED_CONTENT_TRANSITION_MS);

    return () => window.clearTimeout(timeoutId);
  }, [hasExpandedDetails, isExpandedPanelVisible, shouldRenderExpandedContent]);

  const handleToggle = () => {
    if (!hasExpandedDetails) {
      return;
    }

    const nextExpanded = !isExpanded;

    if (nextExpanded) {
      setShouldRenderExpandedContent(true);
    }

    setIsExpanded(nextExpanded);
  };

  // Resolve the icon to show in the header.
  const isRunning = state.running;
  const resolvedIcon = isRunning ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
  ) : (
    (icon ?? indicator ?? <StatusIndicator state={state} />)
  );

  return (
    <div className="-mx-1.5 rounded-md border border-transparent bg-transparent">
      <div
        className={cn(
          "group flex min-w-0 select-none items-center gap-2 rounded-md px-1.5 py-1 text-sm",
          hasExpandedDetails &&
            "cursor-pointer transition-colors hover:bg-muted/50",
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
        {/* Icon area */}
        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground/70">
          {showErrorHeader ? (
            <>
              <CircleX className="h-3.5 w-3.5 text-red-500 group-hover:hidden" />
              {isExpandedPanelVisible ? (
                <Minus className="hidden h-3.5 w-3.5 text-muted-foreground group-hover:block" />
              ) : (
                <Plus className="hidden h-3.5 w-3.5 text-muted-foreground group-hover:block" />
              )}
            </>
          ) : hasExpandedDetails && !isRunning ? (
            <>
              <span className="group-hover:hidden">{resolvedIcon}</span>
              {isExpandedPanelVisible ? (
                <Minus className="hidden h-3.5 w-3.5 text-muted-foreground group-hover:block" />
              ) : (
                <Plus className="hidden h-3.5 w-3.5 text-muted-foreground group-hover:block" />
              )}
            </>
          ) : (
            resolvedIcon
          )}
        </span>

        {/* Name + summary */}
        <span
          className={cn(
            "min-w-0 shrink truncate font-medium leading-none",
            showErrorHeader
              ? "text-red-500"
              : state.denied
                ? "text-red-500"
                : "text-foreground",
            nameClassName,
          )}
        >
          {name}
        </span>

        <div className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
          {hasSummary && (
            <span
              className={cn(
                "min-w-0 shrink truncate font-mono text-[13px] leading-none",
                showErrorHeader ? "text-red-400/80" : "text-muted-foreground",
                summaryClassName,
              )}
            >
              {summary}
            </span>
          )}

          {(rightAlignMeta || showErrorHeader) && <span className="flex-1" />}

          {showErrorHeader && hasErrorMeta && (
            <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[12px] leading-none text-red-400/70">
              {errorMeta}
            </span>
          )}

          {hasTrailingMeta && (
            <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[12px] leading-none text-muted-foreground/60">
              {meta}
              {interruptedBadge}
            </span>
          )}
        </div>
      </div>

      {children}

      {showRunningNotice && (
        <div className="mt-2 text-sm text-muted-foreground">Running...</div>
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
          <div className="mt-2 text-sm text-muted-foreground">{output}</div>
        )}

      {state.denied && (
        <div className="mt-2 text-sm text-red-500">
          Denied{state.denialReason ? `: ${state.denialReason}` : ""}
        </div>
      )}

      {hasExpandedDetails && (
        <div
          aria-hidden={!isExpandedPanelVisible}
          inert={!isExpandedPanelVisible}
          className={cn(
            "grid overflow-hidden transition-[grid-template-rows,opacity,margin-top] motion-reduce:transition-none",
            isExpandedPanelVisible
              ? "mt-1.5 grid-rows-[1fr] opacity-100 duration-200 ease-out"
              : "grid-rows-[0fr] opacity-0 pointer-events-none duration-150 ease-out",
          )}
        >
          <div className="min-h-0">
            {shouldRenderExpandedContent && (
              <div className="space-y-2 pb-1">
                {showErrorExpanded &&
                  !hasRenderableContent(expandedContent) && (
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 font-mono text-xs leading-relaxed text-red-400">
                      {errorMessage}
                    </pre>
                  )}
                {expandedContent}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
