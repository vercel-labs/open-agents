"use client";

import type { TaskPendingToolCall } from "@open-harness/agent";
import { formatTokens, toRelativePath } from "@open-harness/shared";
import type { ToolRenderState } from "@open-harness/shared/lib/tool-state";
import {
  FileText,
  FilePlus,
  FolderSearch,
  Globe,
  Hammer,
  Loader2,
  Paintbrush,
  Pencil,
  Search,
  Telescope,
  Terminal,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import type { ToolRendererProps } from "@/app/lib/render-tool";
import { DEFAULT_WORKING_DIRECTORY } from "@/lib/sandbox/config";
import { ToolLayout } from "../tool-layout";

// ---------------------------------------------------------------------------
// Tool name → icon / display name mapping
// ---------------------------------------------------------------------------

type ToolMeta = { displayName: string; icon: ReactNode };

const TOOL_ICON_CLASS = "h-3.5 w-3.5";

function getToolMeta(toolName: string): ToolMeta {
  switch (toolName) {
    case "bash":
      return { displayName: "Bash", icon: <Terminal className={TOOL_ICON_CLASS} /> };
    case "read":
      return { displayName: "Read", icon: <FileText className={TOOL_ICON_CLASS} /> };
    case "write":
      return { displayName: "Create", icon: <FilePlus className={TOOL_ICON_CLASS} /> };
    case "edit":
      return { displayName: "Update", icon: <Pencil className={TOOL_ICON_CLASS} /> };
    case "grep":
      return { displayName: "Grep", icon: <Search className={TOOL_ICON_CLASS} /> };
    case "glob":
      return { displayName: "Glob", icon: <FolderSearch className={TOOL_ICON_CLASS} /> };
    case "web_fetch":
      return { displayName: "Fetch", icon: <Globe className={TOOL_ICON_CLASS} /> };
    case "skill":
      return { displayName: "Skill", icon: <Zap className={TOOL_ICON_CLASS} /> };
    case "task":
      return { displayName: "Task", icon: <Telescope className={TOOL_ICON_CLASS} /> };
    default: {
      const name = toolName.charAt(0).toUpperCase() + toolName.slice(1);
      return { displayName: name, icon: undefined };
    }
  }
}

function getToolSummary(name: string, input: unknown): string {
  const inp = input as Record<string, unknown> | undefined;
  if (!inp) return "";
  switch (name) {
    case "read":
    case "write":
    case "edit": {
      const fp = inp.filePath ?? "";
      return fp ? toRelativePath(String(fp), DEFAULT_WORKING_DIRECTORY) : "";
    }
    case "grep":
    case "glob":
      return inp.pattern ? `'${inp.pattern}'` : "";
    case "bash":
      return inp.command ? String(inp.command) : "";
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Extract completed tool calls from final messages
// ---------------------------------------------------------------------------

type CompletedToolCall = {
  name: string;
  input: unknown;
};

function extractToolCalls(messages: unknown): CompletedToolCall[] {
  if (!Array.isArray(messages)) return [];

  const calls: CompletedToolCall[] = [];
  for (const msg of messages) {
    if (
      typeof msg !== "object" ||
      msg === null ||
      (msg as { role?: string }).role !== "assistant"
    )
      continue;

    const content = (msg as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;

    for (const part of content) {
      if (
        typeof part === "object" &&
        part !== null &&
        (part as { type?: string }).type === "tool-call"
      ) {
        const tc = part as { toolName?: string; args?: unknown };
        if (tc.toolName) {
          calls.push({ name: tc.toolName, input: tc.args });
        }
      }
    }
  }
  return calls;
}

function countToolCalls(messages: unknown): number {
  if (!Array.isArray(messages)) return 0;
  return messages.filter(
    (message) =>
      typeof message === "object" &&
      message !== null &&
      (message as { role?: string }).role === "tool",
  ).length;
}

// ---------------------------------------------------------------------------
// Subagent helpers
// ---------------------------------------------------------------------------

function getSubagentIcon(
  subagentType: string | undefined,
  className: string,
): ReactNode {
  switch (subagentType) {
    case "executor":
      return <Hammer className={className} />;
    case "design":
      return <Paintbrush className={className} />;
    default:
      return <Telescope className={className} />;
  }
}

function getSubagentLabel(subagentType: string | undefined): string {
  switch (subagentType) {
    case "executor":
      return "Executor Subagent";
    case "design":
      return "Design Subagent";
    default:
      return "Explorer Subagent";
  }
}

// ---------------------------------------------------------------------------
// Mini tool call row (used for pending + completed tool list)
// ---------------------------------------------------------------------------

const COMPLETED_STATE: ToolRenderState = {
  running: false,
  interrupted: false,
  denied: false,
  approvalRequested: false,
  isActiveApproval: false,
};

const RUNNING_STATE: ToolRenderState = {
  running: true,
  interrupted: false,
  denied: false,
  approvalRequested: false,
  isActiveApproval: false,
};

function MiniToolCall({
  name,
  input,
  isRunning,
}: {
  name: string;
  input: unknown;
  isRunning: boolean;
}) {
  const meta = getToolMeta(name);
  const summary = getToolSummary(name, input);

  return (
    <ToolLayout
      name={meta.displayName}
      icon={meta.icon}
      summary={summary}
      summaryClassName="font-mono"
      state={isRunning ? RUNNING_STATE : COMPLETED_STATE}
    />
  );
}

// ---------------------------------------------------------------------------
// TaskRenderer
// ---------------------------------------------------------------------------

export function TaskRenderer({
  part,
  state,
  onApprove,
  onDeny,
}: ToolRendererProps<"tool-task">) {
  const input = part.input;
  const desc = input?.task ?? "Spawning subagent";
  const subagentType = input?.subagentType;
  const taskApprovalRequested = part.state === "approval-requested";
  const taskDenied = part.state === "output-denied";

  const hasOutput = part.state === "output-available";
  const isPreliminary = hasOutput && part.preliminary === true;
  const isComplete = hasOutput && !isPreliminary;
  const output = hasOutput ? part.output : undefined;

  const pendingToolCall: TaskPendingToolCall | null = output?.pending ?? null;
  const toolCount =
    output?.toolCallCount ?? (isComplete ? countToolCalls(output?.final) : 0);
  const tokenCount = output?.usage?.inputTokens ?? null;

  // Build mono stats for right-aligned meta
  const statParts: string[] = [];
  if (toolCount > 0) {
    statParts.push(`${toolCount} tool${toolCount !== 1 ? "s" : ""}`);
  }
  if (tokenCount !== null) {
    statParts.push(`${formatTokens(tokenCount)} tokens`);
  }

  const meta =
    statParts.length > 0 ? (
      <span className="font-mono text-xs text-muted-foreground/60">
        {statParts.join(" · ")}
      </span>
    ) : null;

  // --- Expanded content ---
  // While running: show the current pending tool call
  // When complete: show all tool calls from the final messages
  const completedCalls = isComplete ? extractToolCalls(output?.final) : [];

  const hasExpandableContent =
    pendingToolCall !== null || completedCalls.length > 0;

  const expandedContent = hasExpandableContent ? (
    <div className="space-y-0.5 pl-6">
      {/* Live: show current pending tool call with slide-up animation on change */}
      {pendingToolCall && !isComplete && (
        <div
          key={`pending-${toolCount}-${pendingToolCall.name}`}
          style={{ animation: "slide-up-fade 150ms ease-out both" }}
        >
          <MiniToolCall
            name={pendingToolCall.name}
            input={pendingToolCall.input}
            isRunning={isPreliminary}
          />
        </div>
      )}
      {/* Complete: show all tool calls */}
      {isComplete &&
        completedCalls.map((tc, i) => (
          <MiniToolCall
            key={i}
            name={tc.name}
            input={tc.input}
            isRunning={false}
          />
        ))}
    </div>
  ) : undefined;

  const approvalWarning =
    taskApprovalRequested && subagentType === "executor" ? (
      <div className="mt-2 pl-5 text-sm text-yellow-500">
        This executor has full write access and can create, modify, and delete
        files.
      </div>
    ) : undefined;

  return (
    <ToolLayout
      name={getSubagentLabel(subagentType)}
      summary={desc}
      summaryClassName="font-sans"
      meta={meta}
      rightAlignMeta
      state={state}
      icon={getSubagentIcon(subagentType, "h-3.5 w-3.5")}
      nameClassName={taskDenied ? "text-red-500" : undefined}
      expandedContent={expandedContent}
      onApprove={onApprove}
      onDeny={onDeny}
      defaultExpanded={!isComplete}
    >
      {approvalWarning}
    </ToolLayout>
  );
}
