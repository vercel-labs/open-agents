import React, { useEffect, useState, useCallback, useMemo, memo } from "react";
import { Box, Text, useApp, useInput } from "ink";
import {
  isToolUIPart,
  getToolName,
  type FileUIPart,
} from "ai";
import { useChat } from "@ai-sdk/react";
import { renderMarkdown } from "./lib/markdown.js";
import { useChatContext } from "./chat-context.js";
import { useReasoningContext } from "./reasoning-context.js";
import { useExpandedView } from "./expanded-view-context.js";
import { useTodoView } from "./todo-view-context.js";
import { ToolCall, getToolApprovalInfo } from "./components/tool-call.js";
import { ApprovalPanel } from "./components/approval-panel.js";
import { TaskGroupView } from "./components/task-group-view.js";
import { StatusBar, StandaloneTodoList } from "./components/status-bar.js";
import { InputBox } from "./components/input-box.js";
import { Header } from "./components/header.js";
import { pasteCollapseLineThreshold, tuiAgentModelId } from "./config.js";
import { extractTodosFromLastAssistantMessage } from "./utils/extract-todos.js";
import type {
  TUIOptions,
  TUIAgentUIMessagePart,
  TUIAgentUIMessage,
  TUIAgentUIToolPart,
} from "./types.js";

type AppProps = {
  options: TUIOptions;
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

const TextPart = memo(function TextPart({
  text,
  isExpanded,
  timestamp,
  model,
}: {
  text: string;
  isExpanded?: boolean;
  timestamp?: Date;
  model?: string;
}) {
  const rendered = useMemo(() => renderMarkdown(text), [text]);

  return (
    <Box>
      <Text>● </Text>
      <Box flexShrink={1} flexGrow={1}>
        <Text>{rendered}</Text>
      </Box>
      {isExpanded && timestamp && model && (
        <Box marginLeft={2} flexShrink={0}>
          <Text color="gray">
            {formatTime(timestamp)}   {model}
          </Text>
        </Box>
      )}
    </Box>
  );
});

// Tracks reasoning timing without rendering anything
const ReasoningTracker = memo(function ReasoningTracker({
  messageId,
  hasReasoning,
  isReasoningComplete,
}: {
  messageId: string;
  hasReasoning: boolean;
  isReasoningComplete: boolean;
}) {
  const { startReasoning, endReasoning } = useReasoningContext();

  useEffect(() => {
    if (hasReasoning) {
      startReasoning(messageId);
    }
  }, [messageId, hasReasoning, startReasoning]);

  useEffect(() => {
    if (isReasoningComplete) {
      endReasoning(messageId);
    }
  }, [isReasoningComplete, messageId, endReasoning]);

  return null;
});

function ToolPartWrapper({
  part,
  activeApprovalId,
  isExpanded,
}: {
  part: TUIAgentUIToolPart;
  activeApprovalId: string | null;
  isExpanded: boolean;
}) {
  return <ToolCall part={part} activeApprovalId={activeApprovalId} isExpanded={isExpanded} />;
}

type RenderPartOptions = {
  activeApprovalId: string | null;
  messageId: string;
  isStreaming: boolean;
  isExpanded: boolean;
  timestamp?: Date;
  model?: string;
};

const ThinkingPart = memo(function ThinkingPart({
  text,
  isComplete,
}: {
  text: string;
  isComplete: boolean;
}) {
  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Text color="gray" italic>
        ∴ {isComplete ? "Thinking..." : "Thinking..."}
      </Text>
      <Box marginLeft={2} marginTop={1}>
        <Text color="gray" italic>
          {text}
        </Text>
      </Box>
    </Box>
  );
});

function renderPart(
  part: TUIAgentUIMessagePart,
  key: string,
  options: RenderPartOptions,
) {
  const { activeApprovalId, isExpanded, timestamp, model } = options;

  if (isToolUIPart(part)) {
    return (
      <ToolPartWrapper key={key} part={part} activeApprovalId={activeApprovalId} isExpanded={isExpanded} />
    );
  }

  switch (part.type) {
    case "text":
      if (!part.text) return null;
      return (
        <TextPart
          key={key}
          text={part.text}
          isExpanded={isExpanded}
          timestamp={timestamp}
          model={model}
        />
      );

    case "reasoning":
      // Show reasoning inline when in expanded view
      if (isExpanded && part.text) {
        return <ThinkingPart key={key} text={part.text} isComplete={true} />;
      }
      // Reasoning is tracked but not displayed inline (shown in status bar instead)
      return null;

    default:
      return null;
  }
}

const UserMessage = memo(function UserMessage({
  message,
}: {
  message: TUIAgentUIMessage;
}) {
  const text = message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");

  const imageCount = message.parts.filter(
    (p) => p.type === "file" && (p as FileUIPart).mediaType?.startsWith("image/")
  ).length;

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      {imageCount > 0 && (
        <Box>
          <Text color="magenta" bold>
            &gt;{" "}
          </Text>
          <Text color="blue">
            {imageCount === 1 ? "[1 image attached]" : `[${imageCount} images attached]`}
          </Text>
        </Box>
      )}
      {text && (
        <Box>
          <Text color="magenta" bold>
            &gt;{" "}
          </Text>
          <Text color="white" bold>
            {text}
          </Text>
        </Box>
      )}
    </Box>
  );
});

// Group consecutive task parts together while preserving order
type RenderGroup =
  | { type: "part"; part: TUIAgentUIMessagePart; index: number }
  | { type: "task-group"; tasks: TUIAgentUIToolPart[]; startIndex: number };

const AssistantMessage = memo(function AssistantMessage({
  message,
  activeApprovalId,
  isStreaming,
  isExpanded,
}: {
  message: TUIAgentUIMessage;
  activeApprovalId: string | null;
  isStreaming: boolean;
  isExpanded: boolean;
}) {
  const { state } = useChatContext();
  const timestamp = (message as { createdAt?: Date }).createdAt;
  const model = state.model;

  // Check if this message has reasoning and if reasoning is complete
  // Reasoning is complete when there are non-reasoning parts with content after reasoning
  const { hasReasoning, isReasoningComplete } = useMemo(() => {
    let foundReasoning = false;
    let hasContentAfterReasoning = false;

    for (const part of message.parts) {
      if (part.type === "reasoning" && part.text) {
        foundReasoning = true;
      } else if (foundReasoning) {
        // Check if there's meaningful content after reasoning
        if (part.type === "text" && part.text) {
          hasContentAfterReasoning = true;
          break;
        }
        if (isToolUIPart(part)) {
          hasContentAfterReasoning = true;
          break;
        }
      }
    }

    return {
      hasReasoning: foundReasoning,
      isReasoningComplete: foundReasoning && (hasContentAfterReasoning || !isStreaming),
    };
  }, [message.parts, isStreaming]);

  // Group consecutive task parts together, keeping them in linear order
  const renderGroups = useMemo(() => {
    const groups: RenderGroup[] = [];
    let currentTaskGroup: TUIAgentUIToolPart[] = [];
    let taskGroupStartIndex = 0;

    message.parts.forEach((part, index) => {
      const isTask = isToolUIPart(part) && part.type === "tool-task";

      if (isTask) {
        if (currentTaskGroup.length === 0) {
          taskGroupStartIndex = index;
        }
        currentTaskGroup.push(part);
      } else {
        // Flush any pending task group
        if (currentTaskGroup.length > 0) {
          groups.push({
            type: "task-group",
            tasks: currentTaskGroup,
            startIndex: taskGroupStartIndex,
          });
          currentTaskGroup = [];
        }
        groups.push({ type: "part", part, index });
      }
    });

    // Flush remaining task group
    if (currentTaskGroup.length > 0) {
      groups.push({
        type: "task-group",
        tasks: currentTaskGroup,
        startIndex: taskGroupStartIndex,
      });
    }

    return groups;
  }, [message.parts]);

  return (
    <Box flexDirection="column">
      <ReasoningTracker
        messageId={message.id}
        hasReasoning={hasReasoning}
        isReasoningComplete={isReasoningComplete}
      />
      {renderGroups.map((group) => {
        if (group.type === "task-group") {
          return (
            <TaskGroupView
              key={`task-group-${group.startIndex}`}
              taskParts={group.tasks}
              activeApprovalId={activeApprovalId}
            />
          );
        }
        return renderPart(group.part, `${message.id}-${group.index}`, {
          activeApprovalId,
          messageId: message.id,
          isStreaming,
          isExpanded,
          timestamp,
          model,
        });
      })}
    </Box>
  );
});

const Message = memo(function Message({
  message,
  activeApprovalId,
  isStreaming,
  isExpanded,
}: {
  message: TUIAgentUIMessage;
  activeApprovalId: string | null;
  isStreaming: boolean;
  isExpanded: boolean;
}) {
  if (message.role === "user") {
    return <UserMessage message={message} />;
  }
  if (message.role === "assistant") {
    return (
      <AssistantMessage
        message={message}
        activeApprovalId={activeApprovalId}
        isStreaming={isStreaming}
        isExpanded={isExpanded}
      />
    );
  }
  return null;
});

const MessagesList = memo(function MessagesList({
  messages,
  activeApprovalId,
  isStreaming,
  isExpanded,
}: {
  messages: TUIAgentUIMessage[];
  activeApprovalId: string | null;
  isStreaming: boolean;
  isExpanded: boolean;
}) {
  return (
    <Box flexDirection="column">
      {messages.map((message, index) => (
        <Message
          key={message.id}
          message={message}
          activeApprovalId={activeApprovalId}
          isStreaming={isStreaming && index === messages.length - 1}
          isExpanded={isExpanded}
        />
      ))}
    </Box>
  );
});

const ErrorDisplay = memo(function ErrorDisplay({
  error,
}: {
  error: Error | undefined;
}) {
  if (!error) return null;
  return (
    <Box marginTop={1}>
      <Text color="red">Error: {error.message}</Text>
    </Box>
  );
});

function useStatusText(messages: TUIAgentUIMessage[]): string {
  return useMemo(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === "assistant") {
      for (let i = lastMessage.parts.length - 1; i >= 0; i--) {
        const p = lastMessage.parts[i];
        if (
          p &&
          isToolUIPart(p) &&
          (p.state === "input-available" || p.state === "input-streaming")
        ) {
          return `${getToolName(p)}...`;
        }
      }
    }
    return "Thinking...";
  }, [messages]);
}

const StreamingStatusBar = memo(function StreamingStatusBar({
  messages,
}: {
  messages: TUIAgentUIMessage[];
}) {
  const { getThinkingState } = useReasoningContext();
  const { isTodoVisible } = useTodoView();
  const statusText = useStatusText(messages);
  const [, forceUpdate] = useState(0);

  // Get the current message ID to track thinking state
  const lastMessage = messages[messages.length - 1];
  const messageId = lastMessage?.id ?? "";
  const thinkingState = getThinkingState(messageId);

  // Extract input tokens from the last message's metadata
  const inputTokens = lastMessage?.metadata?.usage?.inputTokens ?? null;

  // Extract todos from the most recent assistant message in the current exchange
  const todos = useMemo(
    () => extractTodosFromLastAssistantMessage(messages),
    [messages]
  );

  // Force re-render periodically to update thinking duration while thinking
  useEffect(() => {
    if (thinkingState.isThinking) {
      const timer = setInterval(() => {
        forceUpdate((n) => n + 1);
      }, 1000);
      return () => clearInterval(timer);
    }
    return undefined;
  }, [thinkingState.isThinking]);

  return (
    <StatusBar
      isStreaming={true}
      status={statusText}
      thinkingState={thinkingState}
      todos={todos}
      isTodoVisible={isTodoVisible}
      inputTokens={inputTokens}
    />
  );
});

const InterruptedIndicator = memo(function InterruptedIndicator() {
  return (
    <Box marginLeft={2}>
      <Text color="gray">└ </Text>
      <Text color="yellow">Interrupted</Text>
      <Text color="gray"> · What should the agent do instead?</Text>
    </Box>
  );
});

const ExpandedViewIndicator = memo(function ExpandedViewIndicator() {
  return (
    <Box marginTop={1} borderStyle="single" borderColor="gray" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
      <Text color="gray">Showing detailed transcript · ctrl+o to toggle</Text>
    </Box>
  );
});

function AppContent({ options }: AppProps) {
  const { exit } = useApp();
  const { chat, state, cycleAutoAcceptMode } = useChatContext();
  const { isExpanded, toggleExpanded } = useExpandedView();
  const { isTodoVisible, toggleTodoView } = useTodoView();
  const [wasInterrupted, setWasInterrupted] = useState(false);

  const { messages, sendMessage, status, stop, error } = useChat({
    chat,
  });

  const isStreaming = status === "streaming" || status === "submitted";

  // Clear interrupted state when streaming starts
  useEffect(() => {
    if (isStreaming) {
      setWasInterrupted(false);
    }
  }, [isStreaming]);

  const { hasPendingApproval, activeApprovalId, pendingToolPart } = useMemo(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === "assistant") {
      for (const p of lastMessage.parts) {
        if (isToolUIPart(p) && p.state === "approval-requested") {
          const approval = (p as { approval?: { id: string } }).approval;
          return {
            hasPendingApproval: true,
            activeApprovalId: approval?.id ?? null,
            pendingToolPart: p,
          };
        }
      }
    }
    return { hasPendingApproval: false, activeApprovalId: null, pendingToolPart: null };
  }, [messages]);

  // Extract todos for standalone display when not streaming
  const todos = useMemo(
    () => extractTodosFromLastAssistantMessage(messages),
    [messages]
  );

  // Get approval info for the pending tool
  const approvalInfo = useMemo(() => {
    if (!pendingToolPart) return null;
    return getToolApprovalInfo(pendingToolPart, state.workingDirectory);
  }, [pendingToolPart, state.workingDirectory]);

  useInput((input, key) => {
    if (key.escape && isStreaming) {
      stop();
      setWasInterrupted(true);
    }
    if (input === "c" && key.ctrl) {
      stop();
      exit();
    }
    if (input === "o" && key.ctrl) {
      toggleExpanded();
    }
    if (input === "t" && key.ctrl) {
      toggleTodoView();
    }
  });

  useEffect(() => {
    if (options?.initialPrompt) {
      sendMessage({ text: options.initialPrompt });
    }
  }, []);

  const handleSubmit = useCallback(
    (prompt: string, files?: FileUIPart[]) => {
      if (!isStreaming) {
        sendMessage({ text: prompt, files });
      }
    },
    [isStreaming, sendMessage],
  );

  // Show message list with either approval panel or input box at bottom
  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <Header
        name={options?.header?.name}
        version={options?.header?.version}
        model={options?.header?.model ?? tuiAgentModelId}
        cwd={state.workingDirectory}
      />

      <MessagesList
        messages={messages}
        activeApprovalId={activeApprovalId}
        isStreaming={isStreaming}
        isExpanded={isExpanded}
      />

      {wasInterrupted && !isStreaming && <InterruptedIndicator />}

      <ErrorDisplay error={error} />

      {/* Show approval panel when there's a pending approval (replaces status bar and input) */}
      {hasPendingApproval && activeApprovalId && approvalInfo && pendingToolPart ? (
        <ApprovalPanel
          approvalId={activeApprovalId}
          toolType={approvalInfo.toolType}
          toolCommand={approvalInfo.toolCommand}
          toolDescription={approvalInfo.toolDescription}
          dontAskAgainPattern={approvalInfo.dontAskAgainPattern}
          toolPart={pendingToolPart}
        />
      ) : (
        <>
          {/* Show streaming status bar when streaming */}
          {isStreaming && (
            <StreamingStatusBar messages={messages} />
          )}

          {/* Show standalone todo list when not streaming and has todos */}
          {!isStreaming && todos && todos.length > 0 && (
            <StandaloneTodoList todos={todos} isTodoVisible={isTodoVisible} />
          )}

          {/* Show input box (disabled when streaming) */}
          {!isExpanded && (
            <InputBox
              onSubmit={handleSubmit}
              autoAcceptMode={state.autoAcceptMode}
              onToggleAutoAccept={cycleAutoAcceptMode}
              disabled={isStreaming}
              inputTokens={state.usage.inputTokens ?? 0}
              contextLimit={state.contextLimit}
              pasteCollapseLineThreshold={pasteCollapseLineThreshold}
            />
          )}
        </>
      )}

      {isExpanded && <ExpandedViewIndicator />}
    </Box>
  );
}

export function App({ options }: AppProps) {
  return <AppContent options={options} />;
}
