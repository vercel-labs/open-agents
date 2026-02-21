"use client";

import type { TaskToolUIPart } from "@open-harness/agent";
import { isToolUIPart } from "ai";
import { ExternalLink } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Children, cloneElement, isValidElement } from "react";
import type { BundledTheme } from "shiki";
import { Streamdown } from "streamdown";
import type {
  WebAgentUIMessage,
  WebAgentUIMessagePart,
  WebAgentUIToolPart,
} from "@/app/types";
import { TaskGroupView } from "@/components/task-group-view";
import { ToolCall } from "@/components/tool-call";
import type { Chat } from "@/lib/db/schema";
import { cn } from "@/lib/utils";
import "streamdown/styles.css";

const customComponents = {
  pre: ({ children, ...props }: ComponentProps<"pre">) => {
    const processChildren = (child: ReactNode): ReactNode => {
      if (isValidElement<{ children?: ReactNode }>(child)) {
        const codeContent = child.props.children;
        if (typeof codeContent === "string") {
          return cloneElement(child, {
            children: codeContent.trimEnd(),
          });
        }
      }
      return child;
    };
    return <pre {...props}>{Children.map(children, processChildren)}</pre>;
  },
};

const shikiThemes = ["github-dark", "github-dark"] as [
  BundledTheme,
  BundledTheme,
];

type ChatWithMessages = {
  chat: Chat;
  messages: WebAgentUIMessage[];
};

type SharedSession = {
  title: string;
  repoOwner: string | null;
  repoName: string | null;
  branch: string | null;
  cloneUrl: string | null;
};

export function SharedChatContent({
  session,
  chats,
}: {
  session: SharedSession;
  chats: ChatWithMessages[];
}) {
  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            {session.repoName ? (
              <>
                {session.cloneUrl ? (
                  /* oxlint-disable-next-line nextjs/no-html-link-for-pages */
                  <a
                    href={`https://github.com/${session.repoOwner}/${session.repoName}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 truncate font-medium text-foreground hover:underline"
                  >
                    {session.repoOwner}/{session.repoName}
                    <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                  </a>
                ) : (
                  <span className="truncate font-medium text-foreground">
                    {session.repoName}
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
              </>
            ) : (
              <span className="truncate font-medium text-foreground">
                {session.title}
              </span>
            )}
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            Shared session
          </span>
        </div>
      </header>

      {/* Messages */}
      <div className="min-w-0 flex-1">
        <div className="mx-auto max-w-3xl overflow-hidden px-4 py-8">
          <div className="space-y-6">
            {chats.map(({ chat, messages }) => (
              <div key={chat.id}>
                {chats.length > 1 && (
                  <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="h-px flex-1 bg-border" />
                    <span>{chat.title}</span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                )}
                <div className="space-y-6">
                  {messages.map((m) => {
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

                    return renderGroups.map((group) => {
                      if (group.type === "task-group") {
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

                      if (p.type === "text") {
                        return (
                          <div
                            key={`${m.id}-${i}`}
                            className={cn(
                              "flex min-w-0",
                              m.role === "user"
                                ? "justify-end"
                                : "justify-start",
                            )}
                          >
                            {m.role === "user" ? (
                              <div className="min-w-0 max-w-[80%] rounded-3xl bg-secondary px-4 py-2">
                                <p className="whitespace-pre-wrap break-words">
                                  {p.text}
                                </p>
                              </div>
                            ) : (
                              <div className="min-w-0 max-w-[80%] overflow-hidden">
                                <Streamdown
                                  mode="static"
                                  isAnimating={false}
                                  shikiTheme={shikiThemes}
                                  components={customComponents}
                                >
                                  {p.text}
                                </Streamdown>
                              </div>
                            )}
                          </div>
                        );
                      }

                      if (isToolUIPart(p)) {
                        return (
                          <div key={`${m.id}-${i}`} className="max-w-full">
                            <ToolCall
                              part={p as WebAgentUIToolPart}
                              isStreaming={false}
                            />
                          </div>
                        );
                      }

                      if (
                        p.type === "file" &&
                        p.mediaType?.startsWith("image/")
                      ) {
                        return (
                          <div
                            key={`${m.id}-${i}`}
                            className="flex justify-end"
                          >
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
                    });
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
