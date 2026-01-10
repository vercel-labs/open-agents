"use client";

import { isToolUIPart } from "ai";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { ToolCall } from "@/components/tool-call";
import type { ComponentProps, ReactNode } from "react";
import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useState,
} from "react";
import type { BundledTheme } from "shiki";
import { Streamdown } from "streamdown";
import { Button } from "@/components/ui/button";
import { useScrollToBottom } from "@/hooks/use-scroll-to-bottom";
import { ChatProvider, useChatContext, type SandboxInfo } from "./chat-context";
import type { WebAgentUIToolPart } from "./types";

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
    <ChatProvider>
      <Chat />
    </ChatProvider>
  );
}

async function createSandbox(): Promise<SandboxInfo> {
  const response = await fetch("/api/sandbox", { method: "POST" });
  if (!response.ok) {
    throw new Error("Failed to create sandbox");
  }
  return response.json();
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
  const { containerRef, isAtBottom, scrollToBottom } =
    useScrollToBottom<HTMLDivElement>();
  const { chat, sandboxInfo, setSandboxInfo, clearSandboxInfo } =
    useChatContext();
  const { messages, error, sendMessage, status, addToolApprovalResponse } =
    chat;

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
      {hasMessages ? (
        <div className="relative flex-1 overflow-hidden">
          <div ref={containerRef} className="h-full overflow-y-auto">
            <div className="mx-auto max-w-3xl px-4 py-8">
              <div className="space-y-6">
                {messages.map((m) =>
                  m.parts.map((p, i) => {
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
                                isAnimating={
                                  status === "streaming" &&
                                  m.id === messages[messages.length - 1]?.id
                                }
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
                  }),
                )}
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

              let currentSandboxId = sandboxInfo?.sandboxId;

              if (!isSandboxValid(sandboxInfo)) {
                setIsCreatingSandbox(true);
                try {
                  const newSandbox = await createSandbox();
                  setSandboxInfo(newSandbox);
                  currentSandboxId = newSandbox.sandboxId;
                } finally {
                  setIsCreatingSandbox(false);
                }
              }

              sendMessage(
                { text: input },
                { body: { sandboxId: currentSandboxId } },
              );
              setInput("");
            }}
            className="flex items-center gap-2 rounded-full bg-muted px-4 py-2"
          >
            <input
              value={input}
              placeholder="Ask anything"
              onChange={(e) => setInput(e.currentTarget.value)}
              disabled={status === "streaming"}
              className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            <Button
              type="submit"
              size="icon"
              disabled={status === "streaming" || !input.trim()}
              className="h-8 w-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
