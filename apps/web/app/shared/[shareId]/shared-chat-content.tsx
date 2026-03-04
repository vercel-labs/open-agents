"use client";

import type { TaskToolUIPart } from "@open-harness/agent";
import { isReasoningUIPart, isToolUIPart } from "ai";
import {
  Bot,
  ExternalLink,
  Eye,
  EyeOff,
  GitBranch,
  GitPullRequest,
  Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Streamdown } from "streamdown";
import type {
  WebAgentUIMessage,
  WebAgentUIMessagePart,
  WebAgentUIToolPart,
} from "@/app/types";
import { TaskGroupView } from "@/components/task-group-view";
import { ThinkingBlock } from "@/components/thinking-block";
import { ToolCall } from "@/components/tool-call";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Chat } from "@/lib/db/schema";
import { streamdownPlugins } from "@/lib/streamdown-config";
import { cn } from "@/lib/utils";
import "streamdown/styles.css";

export type MessageWithTiming = {
  message: WebAgentUIMessage;
  durationMs: number | null;
};

type ChatWithMessages = {
  chat: Chat;
  messagesWithTiming: MessageWithTiming[];
};

type SharedSession = {
  title: string;
  repoOwner: string | null;
  repoName: string | null;
  branch: string | null;
  cloneUrl: string | null;
  prNumber: number | null;
  prStatus: "open" | "merged" | "closed" | null;
};

type SharedBy = {
  username: string;
  name: string | null;
  avatarUrl: string | null;
} | null;

function displayModelName(modelId: string): string {
  const slashIndex = modelId.indexOf("/");
  return slashIndex >= 0 ? modelId.slice(slashIndex + 1) : modelId;
}

function displayProviderName(modelId: string): string {
  const slashIndex = modelId.indexOf("/");
  if (slashIndex < 0) return "";
  const provider = modelId.slice(0, slashIndex);
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return "<1s";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) return `${minutes}m`;
  return `${minutes}m ${remainingSeconds}s`;
}

/** Count all tool-call parts (regular + task groups) in a message */
function countToolCalls(message: WebAgentUIMessage): number {
  let count = 0;
  for (const part of message.parts) {
    if (isToolUIPart(part)) {
      count++;
    }
  }
  return count;
}

export function SharedChatContent({
  session,
  chats,
  modelId,
  sharedBy,
}: {
  session: SharedSession;
  chats: ChatWithMessages[];
  modelId: string | null | undefined;
  sharedBy: SharedBy;
}) {
  const [showToolCalls, setShowToolCalls] = useState(false);

  const hasRepo = session.repoOwner && session.repoName;
  const repoUrl = hasRepo
    ? `https://github.com/${session.repoOwner}/${session.repoName}`
    : null;
  const prUrl =
    repoUrl && session.prNumber ? `${repoUrl}/pull/${session.prNumber}` : null;

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-background text-foreground">
      {/* Hero Header */}
      <header className="border-b border-border bg-background">
        <div className="mx-auto max-w-4xl px-4 py-6">
          {/* Top row: shared by user */}
          {sharedBy && (
            <div className="mb-4 flex items-center gap-2.5">
              <Avatar size="sm">
                {sharedBy.avatarUrl && (
                  <AvatarImage
                    src={sharedBy.avatarUrl}
                    alt={sharedBy.name ?? sharedBy.username}
                  />
                )}
                <AvatarFallback>
                  {(sharedBy.name ?? sharedBy.username).charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm text-muted-foreground">
                Shared by{" "}
                <span className="font-medium text-foreground">
                  {sharedBy.name ?? sharedBy.username}
                </span>
              </span>
            </div>
          )}

          {/* Title */}
          <h1 className="text-lg font-semibold leading-tight text-foreground">
            {session.title}
          </h1>

          {/* Repo / branch / PR line */}
          {hasRepo && (
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <div className="inline-flex items-center gap-1.5 text-muted-foreground">
                <GitBranch className="h-3.5 w-3.5" />
                {repoUrl ? (
                  /* oxlint-disable-next-line nextjs/no-html-link-for-pages */
                  <a
                    href={repoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-foreground hover:underline"
                  >
                    {session.repoOwner}/{session.repoName}
                  </a>
                ) : (
                  <span className="font-medium text-foreground">
                    {session.repoOwner}/{session.repoName}
                  </span>
                )}
                {session.branch && (
                  <>
                    <span className="text-muted-foreground/40">/</span>
                    <span className="text-muted-foreground">
                      {session.branch}
                    </span>
                  </>
                )}
              </div>
              {prUrl && session.prNumber && (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  {/* oxlint-disable-next-line nextjs/no-html-link-for-pages */}
                  <a
                    href={prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <GitPullRequest className="h-3.5 w-3.5" />
                    <span className="font-medium">#{session.prNumber}</span>
                    {session.prStatus && (
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none",
                          session.prStatus === "open" &&
                            "bg-green-500/10 text-green-600 dark:text-green-400",
                          session.prStatus === "merged" &&
                            "bg-purple-500/10 text-purple-600 dark:text-purple-400",
                          session.prStatus === "closed" &&
                            "bg-red-500/10 text-red-600 dark:text-red-400",
                        )}
                      >
                        {session.prStatus}
                      </span>
                    )}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </>
              )}
            </div>
          )}

          {/* Meta pills row */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* Model pill */}
            {modelId && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-2.5 py-1 text-xs text-muted-foreground">
                <Bot className="h-3 w-3" />
                <span className="font-medium text-foreground">
                  {displayModelName(modelId)}
                </span>
                {displayProviderName(modelId) && (
                  <span className="text-muted-foreground/60">
                    · {displayProviderName(modelId)}
                  </span>
                )}
              </span>
            )}
          </div>

          {/* Tool call toggle */}
          <div className="mt-3 flex items-center border-t border-border pt-3">
            <button
              type="button"
              onClick={() => setShowToolCalls((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
                showToolCalls
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
              )}
            >
              {showToolCalls ? (
                <Eye className="h-3 w-3" />
              ) : (
                <EyeOff className="h-3 w-3" />
              )}
              {showToolCalls ? "Tool calls visible" : "Tool calls hidden"}
            </button>
          </div>
        </div>
      </header>

      {/* Messages */}
      <div className="min-w-0 flex-1">
        <div className="mx-auto max-w-4xl overflow-hidden px-4 py-8">
          <div className="space-y-6">
            {chats.map(({ chat, messagesWithTiming }) => (
              <div key={chat.id}>
                {chats.length > 1 && (
                  <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="h-px flex-1 bg-border" />
                    <span>{chat.title}</span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                )}
                <div className="space-y-6">
                  {messagesWithTiming.map(({ message: m, durationMs }) => (
                    <SharedMessage
                      key={m.id}
                      message={m}
                      durationMs={durationMs}
                      showToolCalls={showToolCalls}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Summary bar shown for assistant messages when tool calls are hidden */
function ToolCallSummary({
  toolCallCount,
  durationMs,
}: {
  toolCallCount: number;
  durationMs: number | null;
}) {
  return (
    <div className="flex justify-start">
      <div className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-secondary/30 px-3 py-1.5 text-xs text-muted-foreground">
        <Wrench className="h-3 w-3 text-muted-foreground/70" />
        <span>
          {toolCallCount} tool call{toolCallCount !== 1 ? "s" : ""}
        </span>
        {durationMs != null && durationMs > 0 && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span>{formatDuration(durationMs)}</span>
          </>
        )}
      </div>
    </div>
  );
}

function SharedMessage({
  message: m,
  durationMs,
  showToolCalls,
}: {
  message: WebAgentUIMessage;
  durationMs: number | null;
  showToolCalls: boolean;
}) {
  const toolCallCount = useMemo(() => countToolCalls(m), [m]);
  const hasToolCalls = toolCallCount > 0;

  type RenderGroup =
    | {
        type: "part";
        part: WebAgentUIMessagePart;
        index: number;
      }
    | {
        type: "task-group";
        tasks: TaskToolUIPart[];
        startIndex: number;
      };

  const renderGroups: RenderGroup[] = [];
  let currentTaskGroup: TaskToolUIPart[] = [];
  let taskGroupStartIndex = 0;

  m.parts.forEach((part, index) => {
    if (isToolUIPart(part) && part.type === "tool-task") {
      if (currentTaskGroup.length === 0) {
        taskGroupStartIndex = index;
      }
      currentTaskGroup.push(part as TaskToolUIPart);
    } else {
      if (currentTaskGroup.length > 0) {
        renderGroups.push({
          type: "task-group",
          tasks: currentTaskGroup,
          startIndex: taskGroupStartIndex,
        });
        currentTaskGroup = [];
      }
      renderGroups.push({ type: "part", part, index });
    }
  });

  if (currentTaskGroup.length > 0) {
    renderGroups.push({
      type: "task-group",
      tasks: currentTaskGroup,
      startIndex: taskGroupStartIndex,
    });
  }

  // When tool calls are hidden and this assistant message has tool calls,
  // show a compact summary bar instead
  const showSummary = !showToolCalls && m.role === "assistant" && hasToolCalls;

  return (
    <>
      {showSummary && (
        <ToolCallSummary
          toolCallCount={toolCallCount}
          durationMs={durationMs}
        />
      )}
      {renderGroups.map((group) => {
        if (group.type === "task-group") {
          if (!showToolCalls) return null;
          return (
            <div
              key={`${m.id}-task-group-${group.startIndex}`}
              className="max-w-full"
            >
              <TaskGroupView
                taskParts={group.tasks}
                activeApprovalId={null}
                isStreaming={false}
              />
            </div>
          );
        }

        const p = group.part;
        const i = group.index;

        if (isReasoningUIPart(p)) {
          if (!showToolCalls) return null;
          return (
            <div key={`${m.id}-${i}`} className="flex justify-start">
              <ThinkingBlock text={p.text} isStreaming={false} />
            </div>
          );
        }

        if (p.type === "text") {
          return (
            <div
              key={`${m.id}-${i}`}
              className={cn(
                "flex min-w-0",
                m.role === "user" ? "justify-end" : "justify-start",
              )}
            >
              {m.role === "user" ? (
                <div className="min-w-0 max-w-[80%] rounded-3xl bg-secondary px-4 py-2">
                  <p className="whitespace-pre-wrap break-words">{p.text}</p>
                </div>
              ) : (
                <div className="min-w-0 w-full overflow-hidden">
                  <Streamdown
                    mode="static"
                    isAnimating={false}
                    plugins={streamdownPlugins}
                  >
                    {p.text}
                  </Streamdown>
                </div>
              )}
            </div>
          );
        }

        if (isToolUIPart(p)) {
          if (!showToolCalls) return null;
          return (
            <div key={`${m.id}-${i}`} className="max-w-full">
              <ToolCall part={p as WebAgentUIToolPart} isStreaming={false} />
            </div>
          );
        }

        if (p.type === "file" && p.mediaType?.startsWith("image/")) {
          return (
            <div key={`${m.id}-${i}`} className="flex justify-end">
              <div className="max-w-[80%]">
                {/* eslint-disable-next-line @next/next/no-img-element -- Data URLs not supported by next/image */}
                <img
                  src={p.url}
                  alt={p.filename ?? "Attached image"}
                  className="max-h-64 rounded-lg"
                />
              </div>
            </div>
          );
        }

        return null;
      })}
    </>
  );
}
