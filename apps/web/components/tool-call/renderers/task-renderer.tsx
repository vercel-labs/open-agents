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
import {
  extractRenderState,
  getToolName,
  type ToolRendererProps,
} from "@/app/lib/render-tool";
import type { WebAgentUIToolPart } from "@/app/types";
import { DEFAULT_WORKING_DIRECTORY } from "@/lib/sandbox/config";
import { ToolLayout } from "../tool-layout";
import { BashRenderer } from "./bash-renderer";
import { ReadRenderer } from "./read-renderer";
import { WriteRenderer } from "./write-renderer";
import { EditRenderer } from "./edit-renderer";
import { GlobRenderer } from "./glob-renderer";
import { GrepRenderer } from "./grep-renderer";
import { TodoRenderer } from "./todo-renderer";
import { AskUserQuestionRenderer } from "./ask-user-question-renderer";
import { FetchRenderer } from "./fetch-renderer";
import { SkillRenderer } from "./skill-renderer";

// ---------------------------------------------------------------------------
// Tool name → icon / display name mapping (for pending tool call only)
// ---------------------------------------------------------------------------

type ToolMeta = { displayName: string; icon: ReactNode };

const TOOL_ICON_CLASS = "h-3.5 w-3.5";

function getToolMeta(toolName: string): ToolMeta {
  switch (toolName) {
    case "bash":
      return {
        displayName: "Bash",
        icon: <Terminal className={TOOL_ICON_CLASS} />,
      };
    case "read":
      return {
        displayName: "Read",
        icon: <FileText className={TOOL_ICON_CLASS} />,
      };
    case "write":
      return {
        displayName: "Create",
        icon: <FilePlus className={TOOL_ICON_CLASS} />,
      };
    case "edit":
      return {
        displayName: "Update",
        icon: <Pencil className={TOOL_ICON_CLASS} />,
      };
    case "grep":
      return {
        displayName: "Grep",
        icon: <Search className={TOOL_ICON_CLASS} />,
      };
    case "glob":
      return {
        displayName: "Glob",
        icon: <FolderSearch className={TOOL_ICON_CLASS} />,
      };
    case "web_fetch":
      return {
        displayName: "Fetch",
        icon: <Globe className={TOOL_ICON_CLASS} />,
      };
    case "skill":
      return {
        displayName: "Skill",
        icon: <Zap className={TOOL_ICON_CLASS} />,
      };
    case "task":
      return {
        displayName: "Task",
        icon: <Telescope className={TOOL_ICON_CLASS} />,
      };
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
// Extract completed tool calls from final messages and synthesize UI parts
// ---------------------------------------------------------------------------

/** Unwrap AI SDK tool output envelope: { type: "json", value: { ... } } */
function unwrapToolOutput(output: unknown): unknown {
  if (!output || typeof output !== "object") return output;
  const o = output as Record<string, unknown>;
  if (o.type === "json" && o.value && typeof o.value === "object") {
    return o.value;
  }
  return output;
}

function extractToolParts(messages: unknown): WebAgentUIToolPart[] {
  if (!Array.isArray(messages)) return [];

  // First pass: collect tool-call parts from assistant messages
  type CallInfo = { id: string; name: string; input: unknown };
  const calls: CallInfo[] = [];
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
          calls.push({ id: tc.toolCallId, name: tc.toolName, input: tc.input });
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

  // Synthesize WebAgentUIToolPart objects
  return calls.map((call) => {
    const rawOutput = resultMap.get(call.id);
    const output = unwrapToolOutput(rawOutput);
    return {
      type: `tool-${call.name}`,
      toolCallId: call.id,
      state: "output-available",
      input: call.input,
      output,
    } as unknown as WebAgentUIToolPart;
  });
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
// Pending tool call (streaming only — no output yet)
// ---------------------------------------------------------------------------

const IDLE_STATE: ToolRenderState = {
  running: false,
  interrupted: false,
  denied: false,
  approvalRequested: false,
  isActiveApproval: false,
};

/**
 * Render a completed subagent tool call using the real renderers.
 * This is a local dispatch to avoid circular imports with tool-call.tsx.
 */
function SubagentToolCall({ part }: { part: WebAgentUIToolPart }) {
  const state = extractRenderState(part, null, false);
  const cwd = DEFAULT_WORKING_DIRECTORY;

  switch (part.type) {
    case "tool-bash":
      return <BashRenderer part={part} state={state} />;
    case "tool-read":
      return <ReadRenderer part={part} state={state} cwd={cwd} />;
    case "tool-write":
      return <WriteRenderer part={part} state={state} cwd={cwd} />;
    case "tool-edit":
      return <EditRenderer part={part} state={state} cwd={cwd} />;
    case "tool-glob":
      return <GlobRenderer part={part} state={state} />;
    case "tool-grep":
      return <GrepRenderer part={part} state={state} />;
    case "tool-todo_write":
      return <TodoRenderer part={part} state={state} />;
    case "tool-ask_user_question":
      return <AskUserQuestionRenderer part={part} state={state} />;
    case "tool-web_fetch":
      return <FetchRenderer part={part} state={state} />;
    case "tool-skill":
      return <SkillRenderer part={part} state={state} />;
    default: {
      const toolName = getToolName(part);
      const name = toolName.charAt(0).toUpperCase() + toolName.slice(1);
      const input = part.input as Record<string, unknown> | undefined;
      const summary = input ? JSON.stringify(input).slice(0, 40) : "...";
      return (
        <ToolLayout
          name={name}
          summary={summary}
          summaryClassName="font-mono"
          meta={part.state === "output-available" ? "Done" : undefined}
          state={state}
        />
      );
    }
  }
}

function PendingMiniToolCall({
  name,
  input,
}: {
  name: string;
  input: unknown;
}) {
  const meta = getToolMeta(name);
  const summary = getToolSummary(name, input);

  return (
    <ToolLayout
      name={meta.displayName}
      icon={meta.icon}
      summary={summary}
      summaryClassName="font-mono"
      state={IDLE_STATE}
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
  // When complete: show all tool calls using the real ToolCall component
  const completedParts = isComplete ? extractToolParts(output?.final) : [];

  const hasExpandableContent =
    pendingToolCall !== null || completedParts.length > 0;

  const expandedContent = hasExpandableContent ? (
    <div className="space-y-0.5 pl-6">
      {/* Live: show current pending tool call with slide-up animation */}
      {pendingToolCall && !isComplete && (
        <div
          key={`pending-${toolCount}-${pendingToolCall.name}`}
          style={{ animation: "slide-up-fade 150ms ease-out both" }}
        >
          <PendingMiniToolCall
            name={pendingToolCall.name}
            input={pendingToolCall.input}
          />
        </div>
      )}
      {/* Complete: render real tool call components */}
      {isComplete &&
        completedParts.map((toolPart) => (
          <SubagentToolCall key={toolPart.toolCallId} part={toolPart} />
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
