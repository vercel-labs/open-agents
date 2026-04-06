"use client";

import type { TaskPendingToolCall } from "@open-harness/agent";
import { formatTokens, toRelativePath } from "@open-harness/shared";
import type { ToolRenderState } from "@open-harness/shared/lib/tool-state";
import {
  Bot,
  FileText,
  FilePlus,
  FolderSearch,
  Globe,
  Hammer,
  Paintbrush,
  Pencil,
  Search,
  Telescope,
  Terminal,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
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
  id: string;
  name: string;
  input: unknown;
  output: unknown;
};

function extractToolCalls(messages: unknown): CompletedToolCall[] {
  if (!Array.isArray(messages)) return [];

  // First pass: collect tool-call parts from assistant messages
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
        const tc = part as {
          toolCallId?: string;
          toolName?: string;
          input?: unknown;
        };
        if (tc.toolName && tc.toolCallId) {
          calls.push({
            id: tc.toolCallId,
            name: tc.toolName,
            input: tc.input,
            output: undefined,
          });
        }
      }
    }
  }

  // Second pass: match tool results from tool-role messages
  const resultMap = new Map<string, unknown>();
  for (const msg of messages) {
    if (
      typeof msg !== "object" ||
      msg === null ||
      (msg as { role?: string }).role !== "tool"
    )
      continue;

    const content = (msg as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;

    for (const part of content) {
      if (
        typeof part === "object" &&
        part !== null &&
        (part as { type?: string }).type === "tool-result"
      ) {
        const tr = part as { toolCallId?: string; output?: unknown };
        if (tr.toolCallId) {
          resultMap.set(tr.toolCallId, tr.output);
        }
      }
    }
  }

  // Merge results into calls
  for (const call of calls) {
    call.output = resultMap.get(call.id);
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
    case "explorer":
      return <Telescope className={className} />;
    default:
      return <Bot className={className} />;
  }
}

function getSubagentLabel(subagentType: string | undefined): string {
  switch (subagentType) {
    case "executor":
      return "Executor Subagent";
    case "design":
      return "Design Subagent";
    case "explorer":
      return "Explorer Subagent";
    default:
      return subagentType
        ? `${subagentType.charAt(0).toUpperCase() + subagentType.slice(1)} Subagent`
        : "Subagent";
  }
}

// ---------------------------------------------------------------------------
// Mini tool call row (used for pending + completed tool list)
// ---------------------------------------------------------------------------

const IDLE_STATE: ToolRenderState = {
  running: false,
  interrupted: false,
  denied: false,
  approvalRequested: false,
  isActiveApproval: false,
};

/** Build a short meta string from tool output (e.g. line count, match count). */
function getToolOutputMeta(name: string, output: unknown): string | undefined {
  if (!output || typeof output !== "object") return undefined;
  const o = output as Record<string, unknown>;

  switch (name) {
    case "read": {
      const total = o.totalLines;
      if (typeof total === "number") return `${total} lines`;
      return undefined;
    }
    case "grep": {
      const matches = o.matches;
      if (Array.isArray(matches)) return `${matches.length} matches`;
      return undefined;
    }
    case "glob": {
      const files = o.files;
      if (Array.isArray(files)) return `${files.length} files`;
      return undefined;
    }
    case "edit": {
      if (o.success === false) return "failed";
      return undefined;
    }
    case "write": {
      if (o.success === false) return "failed";
      return undefined;
    }
    case "bash": {
      const exitCode = o.exitCode;
      if (typeof exitCode === "number" && exitCode !== 0)
        return `exit ${exitCode}`;
      return undefined;
    }
    default:
      return undefined;
  }
}

/** Build expandable content from tool output. */
function getToolExpandedContent(
  name: string,
  input: unknown,
  output: unknown,
): ReactNode | undefined {
  if (!output || typeof output !== "object") return undefined;
  const o = output as Record<string, unknown>;

  switch (name) {
    case "bash": {
      const stdout = typeof o.stdout === "string" ? o.stdout.trim() : "";
      const stderr = typeof o.stderr === "string" ? o.stderr.trim() : "";
      const combined = [stdout, stderr].filter(Boolean).join("\n");
      const isError =
        o.success === false ||
        (typeof o.exitCode === "number" && o.exitCode !== 0);
      const exitCode = o.exitCode;
      const command =
        typeof (input as Record<string, unknown> | undefined)?.command ===
        "string"
          ? ((input as Record<string, unknown>).command as string)
          : "";
      return (
        <div
          className={cn(
            "overflow-hidden rounded-md border",
            isError
              ? "border-red-500/20 bg-red-500/5"
              : "border-border bg-muted/50",
          )}
        >
          <div
            className={cn(
              "flex items-center gap-2 px-3 py-1.5",
              combined && "border-b",
              isError ? "border-red-500/20" : "border-border",
            )}
          >
            <Terminal
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                isError ? "text-red-500" : "text-muted-foreground/50",
              )}
            />
            <code
              className={cn(
                "min-w-0 flex-1 truncate font-mono text-xs",
                isError ? "text-red-500" : "text-muted-foreground",
              )}
            >
              {command}
            </code>
            {isError && exitCode !== undefined && (
              <span className="shrink-0 font-mono text-[11px] text-red-400/70">
                exit {String(exitCode)}
              </span>
            )}
          </div>
          {combined && (
            <pre
              className={cn(
                "max-h-48 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-xs leading-relaxed",
                isError ? "text-red-400" : "text-muted-foreground",
              )}
            >
              {combined}
            </pre>
          )}
        </div>
      );
    }
    case "grep": {
      const matches = o.matches;
      if (!Array.isArray(matches) || matches.length === 0) return undefined;
      const files = new Set<string>();
      for (const m of matches) {
        if (typeof m === "object" && m !== null && typeof (m as Record<string, unknown>).file === "string")
          files.add((m as Record<string, unknown>).file as string);
      }
      return (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/50 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
          {`Found ${files.size} file${files.size !== 1 ? "s" : ""}\n${Array.from(files).join("\n")}`}
        </pre>
      );
    }
    case "glob": {
      const files = o.files;
      if (!Array.isArray(files) || files.length === 0) return undefined;
      const paths = files
        .map((f) =>
          typeof f === "object" && f !== null
            ? (f as Record<string, unknown>).path
            : undefined,
        )
        .filter((p): p is string => typeof p === "string");
      return (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/50 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
          {`Found ${paths.length} file${paths.length !== 1 ? "s" : ""}\n${paths.join("\n")}`}
        </pre>
      );
    }
    case "read": {
      const content = typeof o.content === "string" ? o.content.trim() : "";
      if (!content) return undefined;
      // Strip line number prefixes ("N: ")
      const cleaned = content
        .split("\n")
        .map((line) => line.replace(/^\d+: /, ""))
        .join("\n");
      return (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/50 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
          {cleaned}
        </pre>
      );
    }
    case "write": {
      const content = typeof (input as Record<string, unknown> | undefined)?.content === "string"
        ? ((input as Record<string, unknown>).content as string).trim()
        : "";
      if (!content) return undefined;
      const lineCount = content.split("\n").length;
      return (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/50 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
          {`${lineCount} line${lineCount !== 1 ? "s" : ""} written`}
        </pre>
      );
    }
    case "edit": {
      const oldStr = typeof (input as Record<string, unknown> | undefined)?.oldString === "string"
        ? ((input as Record<string, unknown>).oldString as string)
        : "";
      const newStr = typeof (input as Record<string, unknown> | undefined)?.newString === "string"
        ? ((input as Record<string, unknown>).newString as string)
        : "";
      if (!oldStr && !newStr) return undefined;
      const removed = oldStr.split("\n").length;
      const added = newStr.split("\n").length;
      return (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/50 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
          {`-${removed} +${added} lines`}
        </pre>
      );
    }
    case "web_fetch": {
      const status = o.status;
      const statusText = typeof o.statusText === "string" ? o.statusText : "";
      const body = typeof o.body === "string" ? o.body.trim() : "";
      if (!status && !body) return undefined;
      const header = status ? `${status}${statusText ? ` ${statusText}` : ""}` : "";
      const preview = body.length > 500 ? body.slice(0, 500) + "…" : body;
      return (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/50 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
          {[header, preview].filter(Boolean).join("\n\n")}
        </pre>
      );
    }
    default:
      return undefined;
  }
}

/** Detect tool-level errors from output and return an error string, or undefined. */
function getToolError(name: string, output: unknown): string | undefined {
  if (!output || typeof output !== "object") return undefined;
  const o = output as Record<string, unknown>;

  switch (name) {
    case "bash": {
      const exitCode = o.exitCode;
      const failed =
        o.success === false ||
        (typeof exitCode === "number" && exitCode !== 0);
      if (failed) return `Exit code ${exitCode ?? "unknown"}`;
      return undefined;
    }
    case "edit":
    case "write":
    case "read": {
      if (o.success === false) {
        const err = typeof o.error === "string" ? o.error : `${name} failed`;
        return err;
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

function MiniToolCall({
  name,
  input,
  output,
}: {
  name: string;
  input: unknown;
  output?: unknown;
}) {
  const meta = getToolMeta(name);
  const summary = getToolSummary(name, input);
  const outputMeta = output ? getToolOutputMeta(name, output) : undefined;
  const expandedContent = output
    ? getToolExpandedContent(name, input, output)
    : undefined;

  const errorMsg = output ? getToolError(name, output) : undefined;
  const toolState = errorMsg
    ? { ...IDLE_STATE, error: errorMsg }
    : IDLE_STATE;

  return (
    <ToolLayout
      name={meta.displayName}
      icon={meta.icon}
      summary={summary}
      summaryClassName="font-mono"
      meta={outputMeta}
      state={toolState}
      expandedContent={expandedContent}
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
          />
        </div>
      )}
      {/* Complete: show all tool calls */}
      {isComplete &&
        completedCalls.map((tc, i) => (
          <MiniToolCall
            key={tc.id ?? i}
            name={tc.name}
            input={tc.input}
            output={tc.output}
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
