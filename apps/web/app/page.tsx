"use client";

import { isToolUIPart } from "ai";
import { ArrowDown, ArrowUp, GitBranch, Square, X } from "lucide-react";
import { ToolCall } from "@/components/tool-call";
import { TaskGroupView } from "@/components/task-group-view";
import type { ComponentProps, ReactNode } from "react";
import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
} from "react";
import type { BundledTheme } from "shiki";
import { Streamdown } from "streamdown";
import { Button } from "@/components/ui/button";
import { useScrollToBottom } from "@/hooks/use-scroll-to-bottom";
import {
  ChatProvider,
  useChatContext,
  type SandboxInfo,
  type RepoInfo,
} from "./chat-context";
import type { WebAgentUIToolPart, WebAgentUIMessagePart } from "./types";
import type { TaskToolUIPart } from "@open-harness/agent";
import { AuthGuard } from "@/components/auth/auth-guard";
import { RepoSelectionScreen } from "@/components/repo-selection-screen";

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

export default function ChatPage() {
  return (
    <AuthGuard>
      <ChatProvider>
        <ChatFlow />
      </ChatProvider>
    </AuthGuard>
  );
}

function ChatFlow() {
  const { repoInfo, setRepoInfo, clearSandboxInfo } = useChatContext();

  const handleRepoSelect = (owner: string, repo: string, branch: string) => {
    setRepoInfo({
      owner,
      repo,
      fullName: `${owner}/${repo}`,
      cloneUrl: `https://github.com/${owner}/${repo}`,
      branch,
    });
    clearSandboxInfo();
  };

  if (!repoInfo) {
    return <RepoSelectionScreen onSelect={handleRepoSelect} />;
  }

  return <Chat />;
}

async function createSandbox(repoInfo: RepoInfo): Promise<SandboxInfo> {
  const response = await fetch("/api/sandbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repoUrl: repoInfo.cloneUrl,
      branch: repoInfo.branch,
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Failed to create sandbox: ${response.status}${text ? ` - ${text}` : ""}`,
    );
  }
  return await response.json();
}

function isSandboxValid(sandboxInfo: SandboxInfo | null): boolean {
  if (!sandboxInfo) return false;
  const expiresAt = sandboxInfo.createdAt + sandboxInfo.timeout;
  // Add 10 second buffer to avoid edge cases
  return Date.now() < expiresAt - 10_000;
}

function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function SandboxStatus({
  sandboxInfo,
  isCreating,
  onKill,
}: {
  sandboxInfo: SandboxInfo | null;
  isCreating: boolean;
  onKill: () => void;
}) {
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!sandboxInfo) {
      setTimeRemaining(null);
      return;
    }

    const updateTime = () => {
      const expiresAt = sandboxInfo.createdAt + sandboxInfo.timeout;
      const remaining = expiresAt - Date.now();
      setTimeRemaining(remaining > 0 ? remaining : 0);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [sandboxInfo]);

  if (isCreating) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
        <span>Creating sandbox...</span>
      </div>
    );
  }

  if (!sandboxInfo || timeRemaining === null) {
    return null;
  }

  if (timeRemaining <= 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="h-2 w-2 rounded-full bg-red-500" />
        <span>Sandbox expired</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="h-2 w-2 rounded-full bg-green-500" />
      <span>{formatTimeRemaining(timeRemaining)}</span>
      <button
        type="button"
        onClick={onKill}
        className="rounded p-0.5 hover:bg-muted-foreground/20"
        title="Stop sandbox"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function Chat() {
  const [input, setInput] = useState("");
  const [isCreatingSandbox, setIsCreatingSandbox] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { containerRef, isAtBottom, scrollToBottom } =
    useScrollToBottom<HTMLDivElement>();
  const { chat, sandboxInfo, setSandboxInfo, clearSandboxInfo, repoInfo } =
    useChatContext();
  const {
    messages,
    error,
    sendMessage,
    status,
    addToolApprovalResponse,
    stop,
  } = chat;

  const handleKillSandbox = async () => {
    if (!sandboxInfo) return;
    try {
      await fetch("/api/sandbox", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandboxId: sandboxInfo.sandboxId }),
      });
    } finally {
      clearSandboxInfo();
    }
  };

  useEffect(() => {
    if (isAtBottom) {
      scrollToBottom();
    }
  }, [messages, isAtBottom, scrollToBottom]);

  useEffect(() => {
    if (status !== "streaming") {
      inputRef.current?.focus();
    }
  }, [status]);

  const hasMessages = messages.length > 0;

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-destructive">{error.message}</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {repoInfo && (
        <div className="flex items-center border-b border-border px-4 py-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{repoInfo.fullName}</span>
            <span className="flex items-center gap-1">
              <GitBranch className="h-3 w-3" />
              {repoInfo.branch}
            </span>
          </div>
        </div>
      )}
      {hasMessages ? (
        <div className="relative flex-1 overflow-hidden">
          <div ref={containerRef} className="h-full overflow-y-auto">
            <div className="mx-auto max-w-3xl px-4 py-8">
              <div className="space-y-6">
                {messages.map((m, messageIndex) => {
                  const isLastMessage = messageIndex === messages.length - 1;
                  const isMessageStreaming =
                    status === "streaming" && isLastMessage;

                  // Group consecutive task parts together
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
                      // Flush any pending task group
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

                  // Flush remaining task group
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
                            activeApprovalId={
                              group.tasks.find(
                                (t) => t.state === "approval-requested",
                              )?.approval?.id ?? null
                            }
                            isStreaming={isMessageStreaming}
                            onApprove={(id) =>
                              addToolApprovalResponse({ id, approved: true })
                            }
                            onDeny={(id, reason) =>
                              addToolApprovalResponse({
                                id,
                                approved: false,
                                reason,
                              })
                            }
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
                          className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                        >
                          {m.role === "user" ? (
                            <div className="max-w-[80%] rounded-3xl bg-secondary px-4 py-2">
                              <p className="whitespace-pre-wrap">{p.text}</p>
                            </div>
                          ) : (
                            <div className="max-w-[80%]">
                              <Streamdown
                                isAnimating={isMessageStreaming}
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
                            isStreaming={isMessageStreaming}
                            onApprove={(id) =>
                              addToolApprovalResponse({ id, approved: true })
                            }
                            onDeny={(id, reason) =>
                              addToolApprovalResponse({
                                id,
                                approved: false,
                                reason,
                              })
                            }
                          />
                        </div>
                      );
                    }

                    return null;
                  });
                })}
              </div>
            </div>
          </div>
          {!isAtBottom && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-secondary text-secondary-foreground hover:bg-accent"
              onClick={scrollToBottom}
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center">
          <h1 className="mb-8 text-3xl font-light text-foreground">
            What can I help with?
          </h1>
        </div>
      )}

      <div className="p-4 pb-8">
        <div className="mx-auto max-w-3xl space-y-2">
          <div className="flex justify-end px-2">
            <SandboxStatus
              sandboxInfo={sandboxInfo}
              isCreating={isCreatingSandbox}
              onKill={handleKillSandbox}
            />
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!input.trim()) return;

              const messageText = input;
              setInput("");

              if (!isSandboxValid(sandboxInfo)) {
                if (!repoInfo) {
                  // Should not happen as ChatFlow guards this
                  return;
                }
                setIsCreatingSandbox(true);
                try {
                  const newSandbox = await createSandbox(repoInfo);
                  setSandboxInfo(newSandbox);
                } catch {
                  // Restore input on error so user doesn't lose their message
                  setInput(messageText);
                  return;
                } finally {
                  setIsCreatingSandbox(false);
                }
              }

              sendMessage({ text: messageText });
            }}
            className="flex items-center gap-2 rounded-full bg-muted px-4 py-2"
          >
            <input
              ref={inputRef}
              value={input}
              placeholder="Ask anything"
              onChange={(e) => setInput(e.currentTarget.value)}
              disabled={status === "streaming"}
              className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            {status === "streaming" ? (
              <Button
                type="button"
                size="icon"
                onClick={stop}
                className="h-8 w-8 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                <Square className="h-3 w-3 fill-current" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                disabled={!input.trim()}
                className="h-8 w-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
