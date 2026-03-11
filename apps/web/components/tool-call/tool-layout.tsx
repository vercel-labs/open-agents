"use client";

import type { ToolRenderState } from "@open-harness/shared/lib/tool-state";
import { ChevronRight, Loader2 } from "lucide-react";
import type React from "react";
import { type ReactNode, useEffect, useState } from "react";
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

const MAX_ERROR_PREVIEW_LENGTH = 72;
const EXPANDED_CONTENT_TRANSITION_MS = 200;

function trimErrorPrefix(message: string) {
  return message.replace(/^Error:\s*/i, "").trim();
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
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
  const errorMessage =
    state.error && !state.denied ? trimErrorPrefix(state.error) : undefined;
  const errorPreview = errorMessage
    ? truncateText(errorMessage, MAX_ERROR_PREVIEW_LENGTH)
    : undefined;
  const hasErrorDetails = Boolean(errorMessage);
  const hasExpandedDetails =
    hasRenderableContent(expandedContent) || hasErrorDetails;
  const hasOutput = hasRenderableContent(output);
  const hasMeta = hasRenderableContent(meta);
  const hasSummary = summary.trim().length > 0;
  const showRunningNotice =
    state.approvalRequested && !showApprovalButtons && !state.interrupted;
  const interruptedBadge = state.interrupted ? (
    <span className="inline-flex items-center rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-[11px] font-medium leading-none text-yellow-600 dark:text-yellow-400">
      Interrupted
    </span>
  ) : null;
  const hasTrailingMeta =
    hasMeta || interruptedBadge !== null || errorPreview !== undefined;
  const isExpandedPanelVisible = isExpanded && hasExpandedDetails;
  const [shouldRenderExpandedContent, setShouldRenderExpandedContent] =
    useState(defaultExpanded && hasExpandedDetails);

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

  const headerIndicator = indicator ?? <StatusIndicator state={state} />;

  return (
    <div className="my-1.5 rounded-md border border-transparent bg-transparent py-0.5">
      <div
        className={cn(
          "flex min-w-0 select-none items-baseline gap-2 rounded-md py-0.5 pr-1 text-sm",
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
        <span className="flex size-3.5 shrink-0 items-center justify-start self-center">
          {headerIndicator}
        </span>
        <span
          className={cn(
            "shrink-0 font-medium leading-none",
            state.denied || errorMessage ? "text-red-500" : "text-foreground",
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
            <span
              className={cn(
                "inline-flex min-w-0 items-center gap-1.5 text-[13px] leading-none text-muted-foreground",
                errorPreview ? "shrink overflow-hidden" : "shrink-0",
              )}
            >
              {meta}
              {interruptedBadge}
              {errorPreview && (
                <span className="max-w-56 truncate text-[12px] text-red-600/80 dark:text-red-400/90 sm:max-w-72">
                  {errorPreview}
                </span>
              )}
            </span>
          )}
        </div>

        {hasExpandedDetails && (
          <span className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center self-center text-muted-foreground/70">
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 transition-transform duration-200 ease-out motion-reduce:transition-none",
                isExpandedPanelVisible && "rotate-90",
              )}
            />
          </span>
        )}
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
                {errorMessage && (
                  <div className="space-y-1">
                    <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-red-600 dark:text-red-400">
                      Error
                    </div>
                    <p className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-red-600/90 dark:text-red-400/90">
                      {errorMessage}
                    </p>
                  </div>
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
