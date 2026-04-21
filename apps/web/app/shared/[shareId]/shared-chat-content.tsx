"use client";

import { isReasoningUIPart, isToolUIPart } from "ai";
import {
  ArrowRight,
  Bot,
  ExternalLink,
  GitBranch,
  GitPullRequest,
} from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { Streamdown } from "streamdown";
import type {
  WebAgentUIMessage,
  WebAgentUIMessagePart,
  WebAgentUIToolPart,
} from "@/app/types";
import {
  AssistantFileLink,
  type AssistantFileLinkProps,
} from "@/components/assistant-file-link";
import { AssistantMessageGroups } from "@/components/assistant-message-groups";
import { SnippetChip } from "@/components/snippet-chip";
import { ThinkingBlock } from "@/components/thinking-block";
import { ToolCall } from "@/components/tool-call";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { Chat } from "@/lib/db/schema";
import { streamdownPlugins } from "@/lib/streamdown-config";
import { cn } from "@/lib/utils";
import { SharedChatStatus } from "./shared-chat-status";
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

type ReasoningMessagePart = Extract<
  WebAgentUIMessagePart,
  { type: "reasoning" }
>;

function displayModelName(
  modelId: string,
  resolvedModelName: string | null,
): string {
  if (resolvedModelName) {
    return resolvedModelName;
  }

  if (modelId.startsWith("variant:")) {
    return "Custom variant";
  }

  const slashIndex = modelId.indexOf("/");
  return slashIndex >= 0 ? modelId.slice(slashIndex + 1) : modelId;
}

function displayProviderName(modelId: string): string {
  const slashIndex = modelId.indexOf("/");
  if (slashIndex < 0) return "";
  const provider = modelId.slice(0, slashIndex);
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function getReasoningGroupText(parts: ReasoningMessagePart[]): string {
  return parts
    .map((part) => part.text)
    .filter((text) => text.trim().length > 0)
    .join("\n\n");
}

export function SharedChatContent({
  session,
  chats,
  modelId,
  modelName,
  sharedBy,
  ownerSessionHref,
  isStreaming,
  lastUserMessageSentAt,
  shareId,
}: {
  session: SharedSession;
  chats: ChatWithMessages[];
  modelId: string | null | undefined;
  modelName: string | null;
  sharedBy: SharedBy;
  ownerSessionHref: string | null;
  isStreaming: boolean;
  lastUserMessageSentAt: string | null;
  shareId: string;
}) {
  const hasRepo = session.repoOwner && session.repoName;
  const repoUrl = hasRepo
    ? `https://github.com/${session.repoOwner}/${session.repoName}`
    : null;
  const prUrl =
    repoUrl && session.prNumber ? `${repoUrl}/pull/${session.prNumber}` : null;

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border bg-background">
        <div className="mx-auto max-w-4xl px-4 py-4">
          {/* Title + meta row: inline on desktop */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            {/* Left: title + repo */}
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-semibold leading-tight text-foreground">
                {session.title}
              </h1>

              {/* Inline meta: repo · branch · PR · model — all on one line on desktop */}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                {hasRepo && (
                  <>
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
                          <span className="font-medium">
                            #{session.prNumber}
                          </span>
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
                    {modelId && (
                      <span className="text-muted-foreground/40">·</span>
                    )}
                  </>
                )}
                {modelId && (
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Bot className="h-3 w-3" />
                    <span className="font-medium text-foreground">
                      {displayModelName(modelId, modelName)}
                    </span>
                    {displayProviderName(modelId) && (
                      <span className="text-muted-foreground/60">
                        · {displayProviderName(modelId)}
                      </span>
                    )}
                  </span>
                )}
              </div>
            </div>

            {/* Right: shared by user */}
            {sharedBy && (
              <div className="flex shrink-0 items-center gap-2">
                <Avatar size="sm">
                  {sharedBy.avatarUrl && (
                    <AvatarImage
                      src={sharedBy.avatarUrl}
                      alt={sharedBy.name ?? sharedBy.username}
                    />
                  )}
                  <AvatarFallback>
                    {(sharedBy.name ?? sharedBy.username)
                      .charAt(0)
                      .toUpperCase()}
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
          </div>
        </div>
      </header>

      {/* Messages */}
      <div className="min-w-0 flex-1">
        <div className="mx-auto max-w-4xl overflow-hidden px-4 py-8">
          <div className="space-y-4">
            {/* Owner banner — between header and messages */}
            {ownerSessionHref && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-secondary/40 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    You own this shared chat
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Open the original session to keep working from your private
                    view.
                  </p>
                </div>
                <Button size="sm" asChild className="shrink-0">
                  <Link href={ownerSessionHref}>
                    Open session
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            )}
            {chats.map(({ chat, messagesWithTiming }) => (
              <div key={chat.id}>
                {chats.length > 1 && (
                  <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="h-px flex-1 bg-border" />
                    <span>{chat.title}</span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                )}
                <div className="space-y-4">
                  {messagesWithTiming.map(({ message: m, durationMs }) => (
                    <SharedMessage
                      key={m.id}
                      message={m}
                      durationMs={durationMs}
                      isStreaming={false}
                      lastUserMessageSentAt={lastUserMessageSentAt}
                    />
                  ))}
                </div>
              </div>
            ))}
            {/* Inline streaming status indicator */}
            <SharedChatStatus
              shareId={shareId}
              initialIsStreaming={isStreaming}
              initialLastUserMessageSentAt={lastUserMessageSentAt}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function SharedMessage({
  message: m,
  durationMs,
  isStreaming,
  lastUserMessageSentAt,
}: {
  message: WebAgentUIMessage;
  durationMs: number | null;
  isStreaming: boolean;
  lastUserMessageSentAt: string | null;
}) {
  // Group consecutive reasoning parts (same as session chat)
  type RenderGroup =
    | {
        type: "part";
        part: WebAgentUIMessagePart;
        index: number;
      }
    | {
        type: "reasoning-group";
        parts: ReasoningMessagePart[];
        startIndex: number;
      };

  const renderGroups: RenderGroup[] = [];
  let currentReasoningGroup: ReasoningMessagePart[] = [];
  let reasoningGroupStartIndex = 0;

  const flushReasoningGroup = () => {
    if (currentReasoningGroup.length === 0) {
      return;
    }

    renderGroups.push({
      type: "reasoning-group",
      parts: currentReasoningGroup,
      startIndex: reasoningGroupStartIndex,
    });
    currentReasoningGroup = [];
  };

  m.parts.forEach((part, index) => {
    if (isReasoningUIPart(part)) {
      if (currentReasoningGroup.length === 0) {
        reasoningGroupStartIndex = index;
      }
      currentReasoningGroup.push(part);
      return;
    }

    flushReasoningGroup();
    renderGroups.push({ type: "part", part, index });
  });

  flushReasoningGroup();

  const streamdownComponents = useMemo(
    () => ({
      a: (props: AssistantFileLinkProps) => <AssistantFileLink {...props} />,
    }),
    [],
  );

  const isUser = m.role === "user";

  const renderGroupElements = (isExpanded: boolean) =>
    renderGroups.map((group) => {
      if (group.type === "reasoning-group") {
        if (!isExpanded) return null;
        return (
          <div
            key={`${m.id}-reasoning-group-${group.startIndex}`}
            className="max-w-full pl-[22px]"
          >
            <ThinkingBlock
              text={getReasoningGroupText(group.parts)}
              isStreaming={false}
              partCount={group.parts.length}
            />
          </div>
        );
      }

      const p = group.part;
      const i = group.index;

      if (isReasoningUIPart(p)) {
        if (!isExpanded) return null;
        return (
          <div key={`${m.id}-${i}`} className="max-w-full pl-[22px]">
            <ThinkingBlock text={p.text} isStreaming={false} />
          </div>
        );
      }

      if (p.type === "text") {
        if (p.text.length === 0) {
          return null;
        }

        const isFinalAssistantTextPart =
          m.role === "assistant" &&
          !m.parts
            .slice(i + 1)
            .some((messagePart) => messagePart.type === "text");

        // When collapsed, hide every text part except the final one
        if (
          !isExpanded &&
          m.role === "assistant" &&
          !isFinalAssistantTextPart
        ) {
          return null;
        }

        return (
          <div
            key={`${m.id}-${i}`}
            className={cn(
              "flex min-w-0 py-2",
              m.role === "user" ? "justify-end" : "justify-start",
              // Breathing room above final assistant text after tool calls
              isFinalAssistantTextPart && i > 0 && "mt-4",
              // Indent non-final text parts (they're collapsible content)
              m.role === "assistant" &&
                !isFinalAssistantTextPart &&
                "pl-[22px]",
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
                  components={streamdownComponents}
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
        if (!isExpanded) return null;
        return (
          <div key={`${m.id}-${i}`} className="max-w-full pl-[22px]">
            <ToolCall part={p as WebAgentUIToolPart} isStreaming={false} />
          </div>
        );
      }

      if (p.type === "file" && p.mediaType?.startsWith("image/")) {
        if (!isExpanded && m.role === "assistant") {
          return null;
        }
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

      if (p.type === "data-snippet") {
        return (
          <div key={`${m.id}-${i}`} className="flex justify-end">
            <div className="max-w-[80%]">
              <SnippetChip
                filename={p.data.filename}
                content={p.data.content}
              />
            </div>
          </div>
        );
      }

      return null;
    });

  if (isUser) {
    return (
      <div className="flex flex-col gap-1">{renderGroupElements(true)}</div>
    );
  }

  // Assistant messages: wrap with collapsible summary bar (same as session chat)
  return (
    <AssistantMessageGroups
      message={m}
      isStreaming={isStreaming}
      durationMs={durationMs}
      startedAt={isStreaming ? lastUserMessageSentAt : null}
    >
      {renderGroupElements}
    </AssistantMessageGroups>
  );
}
