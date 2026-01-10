"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useScrollToBottom } from "@/hooks/use-scroll-to-bottom";

export default function Chat() {
  const [input, setInput] = useState("");
  const { containerRef, isAtBottom, scrollToBottom } =
    useScrollToBottom<HTMLDivElement>();
  const { messages, error, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  useEffect(() => {
    if (isAtBottom) {
      scrollToBottom();
    }
  }, [messages, isAtBottom, scrollToBottom]);

  const hasMessages = messages.length > 0;

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-900">
        <p className="text-red-400">{error.message}</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-zinc-900 text-zinc-100">
      {hasMessages ? (
        <div className="relative flex-1 overflow-hidden">
          <div ref={containerRef} className="h-full overflow-y-auto">
            <div className="mx-auto max-w-3xl px-4 py-8">
              <div className="space-y-6">
                {messages.map((m) =>
                  m.parts.map((p, i) => {
                    switch (p.type) {
                      case "text":
                        return (
                          <div
                            key={`${m.id}-${i}`}
                            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                          >
                            {m.role === "user" ? (
                              <div className="max-w-[80%] rounded-3xl bg-zinc-700 px-4 py-2">
                                <p className="whitespace-pre-wrap">{p.text}</p>
                              </div>
                            ) : (
                              <div className="max-w-[80%]">
                                <p className="whitespace-pre-wrap">{p.text}</p>
                              </div>
                            )}
                          </div>
                        );
                      default:
                        return null;
                    }
                  }),
                )}
              </div>
            </div>
          </div>
          {!isAtBottom && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-zinc-700 text-zinc-100 hover:bg-zinc-600"
              onClick={scrollToBottom}
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center">
          <h1 className="mb-8 text-3xl font-light text-zinc-100">
            What can I help with?
          </h1>
        </div>
      )}

      <div className="p-4 pb-8">
        <div className="mx-auto max-w-3xl">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!input.trim()) return;
              sendMessage({ text: input });
              setInput("");
            }}
            className="flex items-center gap-2 rounded-full bg-zinc-800 px-4 py-2"
          >
            <input
              value={input}
              placeholder="Ask anything"
              onChange={(e) => setInput(e.currentTarget.value)}
              disabled={status === "streaming"}
              className="flex-1 bg-transparent text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
            />
            <Button
              type="submit"
              size="icon"
              disabled={status === "streaming" || !input.trim()}
              className="h-8 w-8 rounded-full bg-zinc-100 text-zinc-900 hover:bg-zinc-200 disabled:opacity-30"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
