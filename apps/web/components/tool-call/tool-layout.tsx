"use client";

import type { ToolRenderState } from "@open-harness/shared/lib/tool-state";
import { Loader2 } from "lucide-react";
import type React from "react";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";
import { ApprovalButtons } from "./approval-buttons";

export type ToolLayoutProps = {
  name: string;
  summary: string;
  state: ToolRenderState;
  output?: ReactNode;
  children?: ReactNode;
  expandedContent?: ReactNode;
  onApprove?: (id: string) => void;
  onDeny?: (id: string, reason?: string) => void;
};

function StatusDot({ state }: { state: ToolRenderState }) {
  // Show empty circle for interrupted state
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

export function ToolLayout({
  name,
  summary,
  state,
  output,
  children,
  expandedContent,
  onApprove,
  onDeny,
}: ToolLayoutProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const showApprovalButtons =
    state.approvalRequested && !state.isActiveApproval && state.approvalId;
  const hasExpandedContent = Boolean(expandedContent);

  const handleClick = () => {
    if (hasExpandedContent) {
      setIsExpanded(!isExpanded);
    }
  };

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border bg-card p-3">
      <div
        className={cn(
          "flex min-w-0 items-center gap-2",
          hasExpandedContent && "cursor-pointer",
        )}
        {...(hasExpandedContent && {
          onClick: handleClick,
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (hasExpandedContent) {
                setIsExpanded(!isExpanded);
              }
            }
          },
          role: "button",
          tabIndex: 0,
          "aria-expanded": isExpanded,
        })}
      >
        <StatusDot state={state} />
        <span
          className={cn(
            "font-medium",
            state.denied ? "text-red-500" : "text-foreground",
          )}
        >
          {name}
        </span>
        <span className="min-w-0 truncate text-sm text-foreground">
          <span className="text-muted-foreground">(</span>
          {summary}
          <span className="text-muted-foreground">)</span>
        </span>
      </div>

      {state.approvalRequested &&
        !showApprovalButtons &&
        !state.interrupted && (
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

      {output &&
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

      {state.interrupted && (
        <div className="mt-2 pl-5 text-sm text-yellow-500">Interrupted</div>
      )}

      {isExpanded && expandedContent && (
        <div className="mt-3 border-t border-border pt-3">
          {expandedContent}
        </div>
      )}

      {children}
    </div>
  );
}
