import { useChat } from "@ai-sdk/react";
import type { AskUserQuestionInput, TaskToolUIPart } from "@open-harness/agent";
import { defaultModelLabel } from "@open-harness/agent";
import {
  useExpandedView,
  useReasoningContext,
  useTodoView,
} from "@open-harness/shared";
import type { ScrollBoxRenderable, Selection } from "@opentui/core";
import { TextAttributes } from "@opentui/core";
import {
  useKeyboard,
  useRenderer,
  useTerminalDimensions,
} from "@opentui/react";
import { type FileUIPart, getToolName, isToolUIPart } from "ai";
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useChatContext } from "./chat-context";
import { ApprovalPanel } from "./components/approval-panel";
import { Header } from "./components/header";
import { InputBox } from "./components/input-box";
import { QuestionPanel } from "./components/question-panel";
import { ResumePanel } from "./components/resume-panel";
import { SettingsPanel } from "./components/settings-panel";
import { StandaloneTodoList, StatusBar } from "./components/status-bar";
import { TaskGroupView } from "./components/task-group-view";
import { getToolApprovalInfo, ToolCall } from "./components/tool-call";
import { pasteCollapseLineThreshold } from "./config";
import { toolMatchesApprovalRule } from "./lib/approval";
import { PRIMARY_COLOR } from "./lib/colors";
import { inputFromKey } from "./lib/keyboard";
import { MarkdownContent } from "./lib/markdown";
import { listSessions, loadSession } from "./lib/session-storage";
import type { SessionListItem } from "./lib/session-types";
import type { SlashCommandAction } from "./lib/slash-commands";
import { copyTextToClipboard } from "./lib/text-clipboard";
import { wrapMarkdown } from "./lib/wrap-markdown";
import type {
  TUIAgentUIMessage,
  TUIAgentUIMessagePart,
  TUIAgentUIToolPart,
  TUIOptions,
} from "./types";
import { extractTodosFromLastAssistantMessage } from "./utils/extract-todos";

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
  isStreaming,
  timestamp,
  model,
}: {
  text: string;
  isExpanded?: boolean;
  isStreaming?: boolean;
  timestamp?: Date;
  model?: string;
}) {
  const { width } = useTerminalDimensions();
  const terminalWidth = width ?? 80;
  const bulletWidth = 2;
  const maxContentWidth = Math.max(10, terminalWidth - bulletWidth);
  const displayText = wrapMarkdown(text, maxContentWidth);
  return (
    <box flexDirection="row">
      <text>●</text>
      <box marginLeft={1} flexShrink={1} flexGrow={1}>
        <MarkdownContent content={displayText} streaming={isStreaming} />
      </box>
      {isExpanded && timestamp && model && (
        <box marginLeft={2} flexShrink={0} flexDirection="row">
          <text fg="gray">
            {formatTime(timestamp)} {model}
          </text>
        </box>
      )}
    </box>
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
  isStreaming,
}: {
  part: TUIAgentUIToolPart;
  activeApprovalId: string | null;
  isExpanded: boolean;
  isStreaming: boolean;
}) {
  return (
    <ToolCall
      part={part}
      activeApprovalId={activeApprovalId}
      isExpanded={isExpanded}
      isStreaming={isStreaming}
    />
  );
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
    <box flexDirection="column" marginTop={1} marginBottom={1}>
      <text fg="gray" attributes={TextAttributes.ITALIC}>
        ∴ {isComplete ? "Thinking..." : "Thinking..."}
      </text>
      <box marginLeft={2} marginTop={1}>
        <text fg="gray" attributes={TextAttributes.ITALIC}>
          {text}
        </text>
      </box>
    </box>
  );
});

function renderPart(
  part: TUIAgentUIMessagePart,
  key: string,
  options: RenderPartOptions,
) {
  const { activeApprovalId, isStreaming, isExpanded, timestamp, model } =
    options;

  if (isToolUIPart(part)) {
    if (part.state === "input-streaming") return null;
    return (
      <ToolPartWrapper
        key={key}
        part={part}
        activeApprovalId={activeApprovalId}
        isExpanded={isExpanded}
        isStreaming={isStreaming}
      />
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
          isStreaming={isStreaming}
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
    (p) => p.type === "file" && p.mediaType?.startsWith("image/"),
  ).length;

  return (
    <box flexDirection="column" marginTop={1} marginBottom={1}>
      {imageCount > 0 && (
        <box
          backgroundColor="#333333"
          paddingLeft={1}
          paddingRight={1}
          alignSelf="flex-start"
          flexDirection="row"
        >
          <text fg="#666666">❯ </text>
          <text fg="blue">
            {imageCount === 1
              ? "[1 image attached]"
              : `[${imageCount} images attached]`}
          </text>
        </box>
      )}
      {text && (
        <box
          backgroundColor="#333333"
          paddingLeft={1}
          paddingRight={1}
          alignSelf="flex-start"
          flexDirection="row"
        >
          <text fg="#666666">❯ </text>
          <text fg="white" attributes={TextAttributes.BOLD}>
            {text}
          </text>
        </box>
      )}
    </box>
  );
});

// Group consecutive task parts together while preserving order
type RenderGroup =
  | { type: "part"; part: TUIAgentUIMessagePart; index: number }
  | { type: "task-group"; tasks: TaskToolUIPart[]; startIndex: number };

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
      isReasoningComplete:
        foundReasoning && (hasContentAfterReasoning || !isStreaming),
    };
  }, [message.parts, isStreaming]);

  // Group consecutive task parts together, keeping them in linear order
  const renderGroups = useMemo(() => {
    const groups: RenderGroup[] = [];
    let currentTaskGroup: TaskToolUIPart[] = [];
    let taskGroupStartIndex = 0;

    message.parts.forEach((part, index) => {
      if (isToolUIPart(part) && part.state === "input-streaming") {
        return;
      }
      if (isToolUIPart(part) && part.type === "tool-task") {
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
    <box flexDirection="column">
      <ReasoningTracker
        messageId={message.id}
        hasReasoning={hasReasoning}
        isReasoningComplete={isReasoningComplete}
      />
      {renderGroups.map((group) => {
        if (group.type === "task-group") {
          const visibleTasks = group.tasks.filter(
            (task) => task.state !== "input-streaming",
          );
          if (visibleTasks.length === 0) return null;
          return (
            <TaskGroupView
              key={`task-group-${group.startIndex}`}
              taskParts={visibleTasks}
              isStreaming={isStreaming}
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
    </box>
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
    <box flexDirection="column">
      {messages.map((message, index) => (
        <Message
          key={message.id || `msg-${index}`}
          message={message}
          activeApprovalId={activeApprovalId}
          isStreaming={isStreaming && index === messages.length - 1}
          isExpanded={isExpanded}
        />
      ))}
    </box>
  );
});

const ErrorDisplay = memo(function ErrorDisplay({
  error,
}: {
  error: Error | undefined;
}) {
  if (!error) return null;
  return (
    <box marginTop={1}>
      <text fg="red">Error: {error.message}</text>
    </box>
  );
});

function useStatusText(messages: TUIAgentUIMessage[]): string {
  return useMemo(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === "assistant") {
      for (let i = lastMessage.parts.length - 1; i >= 0; i--) {
        const p = lastMessage.parts[i];
        if (p && isToolUIPart(p) && p.state === "input-available") {
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
  const inputTokens = lastMessage?.metadata?.lastStepUsage?.inputTokens ?? null;

  // Extract todos from the most recent assistant message in the current exchange
  const todos = useMemo(
    () => extractTodosFromLastAssistantMessage(messages),
    [messages],
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

const ClipboardToast = memo(function ClipboardToast({
  notice,
}: {
  notice: string;
}) {
  const words = notice.split(" ");
  const primary = words[0] ?? notice;
  const secondary = words.slice(1).join(" ");

  return (
    <box
      position="absolute"
      top={1}
      right={2}
      zIndex={1000}
      flexDirection="row"
      flexWrap="no-wrap"
      paddingLeft={2}
      paddingRight={2}
      paddingTop={0}
      paddingBottom={0}
      border
      borderStyle="rounded"
      borderColor="#2f7a3d"
      backgroundColor="#0f1411"
    >
      <text fg="#8fd694">✓</text>
      <text> </text>
      <text fg="#d9dedc">{primary}</text>
      {secondary.length > 0 ? <text fg="#7f8a85"> {secondary}</text> : null}
    </box>
  );
});

const InterruptedIndicator = memo(function InterruptedIndicator() {
  return (
    <box marginLeft={2} flexDirection="row" flexWrap="no-wrap">
      <text fg="gray">└ </text>
      <text fg={PRIMARY_COLOR}>Interrupted</text>
      <text fg="gray"> · What should the agent do instead?</text>
    </box>
  );
});

const ExpandedViewIndicator = memo(function ExpandedViewIndicator() {
  return (
    <box marginTop={1} borderStyle="single" borderColor="gray" border={["top"]}>
      <text fg="gray">Showing detailed transcript · ctrl+o to toggle</text>
    </box>
  );
});

function AppContent({ options }: AppProps) {
  const renderer = useRenderer();
  const lastCopiedSelectionRef = useRef<string | null>(null);
  const noticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionClearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const scrollboxRef = useRef<ScrollBoxRenderable | null>(null);
  const exit = useCallback(() => {
    renderer.destroy();
  }, [renderer]);
  const {
    chat,
    state,
    cycleAutoAcceptMode,
    openPanel,
    closePanel,
    updateSettings,
    setSessionId,
    resetUsage,
  } = useChatContext();
  const { isExpanded, toggleExpanded } = useExpandedView();
  const { isTodoVisible, toggleTodoView } = useTodoView();
  const [wasInterrupted, setWasInterrupted] = useState(false);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [clipboardNotice, setClipboardNotice] = useState<string | null>(null);

  const {
    messages,
    sendMessage,
    status,
    stop,
    error,
    setMessages,
    addToolOutput,
    addToolApprovalResponse,
  } = useChat({
    chat,
  });

  const isStreaming = status === "streaming" || status === "submitted";

  useEffect(() => {
    const handleSelection = (selection: Selection) => {
      if (selection.isSelecting) return;
      const selectedText = selection.getSelectedText();
      if (selectedText.length === 0) {
        lastCopiedSelectionRef.current = null;
        return;
      }
      if (selectedText === lastCopiedSelectionRef.current) return;
      lastCopiedSelectionRef.current = selectedText;

      void (async () => {
        const copied = await copyTextToClipboard(selectedText);
        if (!copied) return;

        if (noticeTimeoutRef.current) {
          clearTimeout(noticeTimeoutRef.current);
        }
        setClipboardNotice("Copied to clipboard");
        noticeTimeoutRef.current = setTimeout(() => {
          setClipboardNotice(null);
        }, 1500);

        if (selectionClearTimeoutRef.current) {
          clearTimeout(selectionClearTimeoutRef.current);
        }
        selectionClearTimeoutRef.current = setTimeout(() => {
          renderer.clearSelection();
        }, 120);
      })();
    };

    renderer.on("selection", handleSelection);
    return () => {
      if (noticeTimeoutRef.current) {
        clearTimeout(noticeTimeoutRef.current);
      }
      if (selectionClearTimeoutRef.current) {
        clearTimeout(selectionClearTimeoutRef.current);
      }
      renderer.off("selection", handleSelection);
    };
  }, [renderer]);

  // Clear interrupted state when streaming starts
  useEffect(() => {
    if (isStreaming) {
      setWasInterrupted(false);
    }
  }, [isStreaming]);

  // Auto-approve matching tools when pending rules are added
  // This handles parallel tool calls where user says "don't ask again" on the first one
  useEffect(() => {
    if (state.pendingApprovalRules.length === 0) return;

    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role !== "assistant") return;

    // Find all tools with approval-requested state
    const pendingApprovalParts = lastMessage.parts.filter(
      (p): p is TUIAgentUIToolPart =>
        isToolUIPart(p) && p.state === "approval-requested",
    );

    for (const part of pendingApprovalParts) {
      const approval = (part as { approval?: { id: string } }).approval;
      if (!approval?.id) continue;

      for (const rule of state.pendingApprovalRules) {
        if (toolMatchesApprovalRule(part, rule, state.workingDirectory)) {
          addToolApprovalResponse({ id: approval.id, approved: true });
          break;
        }
      }
    }
  }, [
    state.pendingApprovalRules,
    messages,
    state.workingDirectory,
    addToolApprovalResponse,
  ]);

  const { hasPendingApproval, activeApprovalId, pendingToolPart } =
    useMemo(() => {
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
      return {
        hasPendingApproval: false,
        activeApprovalId: null,
        pendingToolPart: null,
      };
    }, [messages]);

  // Detect pending askUserQuestion tool calls
  const { hasPendingQuestion, pendingQuestionPart, questionToolCallId } =
    useMemo(() => {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage?.role === "assistant") {
        for (const p of lastMessage.parts) {
          if (
            isToolUIPart(p) &&
            p.type === "tool-ask_user_question" &&
            p.state === "input-available"
          ) {
            return {
              hasPendingQuestion: true,
              pendingQuestionPart: p as {
                type: "tool-ask_user_question";
                toolCallId: string;
                input: AskUserQuestionInput;
              },
              questionToolCallId: p.toolCallId,
            };
          }
        }
      }
      return {
        hasPendingQuestion: false,
        pendingQuestionPart: null,
        questionToolCallId: null,
      };
    }, [messages]);

  const inputVisible =
    !isStreaming &&
    !isExpanded &&
    state.activePanel.type === "none" &&
    !hasPendingQuestion &&
    !hasPendingApproval;

  // Extract todos for standalone display when not streaming
  const todos = useMemo(
    () => extractTodosFromLastAssistantMessage(messages),
    [messages],
  );

  // Get approval info for the pending tool
  const approvalInfo = useMemo(() => {
    if (!pendingToolPart) return null;
    return getToolApprovalInfo(pendingToolPart, state.workingDirectory);
  }, [pendingToolPart, state.workingDirectory]);

  // Handle question submission
  const handleQuestionSubmit = useCallback(
    (answers: Record<string, string | string[]>) => {
      if (questionToolCallId) {
        addToolOutput({
          tool: "ask_user_question",
          toolCallId: questionToolCallId,
          output: { answers },
        });
      }
    },
    [questionToolCallId, addToolOutput],
  );

  // Handle question cancellation
  const handleQuestionCancel = useCallback(() => {
    if (questionToolCallId) {
      addToolOutput({
        tool: "ask_user_question",
        toolCallId: questionToolCallId,
        output: { declined: true },
      });
    }
  }, [questionToolCallId, addToolOutput]);

  useKeyboard((event) => {
    const input = inputFromKey(event);
    if (
      inputVisible &&
      !event.ctrl &&
      !event.meta &&
      (input.length > 0 ||
        event.name === "backspace" ||
        event.name === "delete" ||
        event.name === "return" ||
        event.name === "linefeed" ||
        event.name === "tab")
    ) {
      const scrollbox = scrollboxRef.current;
      if (scrollbox) {
        const viewportHeight = scrollbox.viewport.height;
        if (viewportHeight > 0) {
          const maxScrollTop = Math.max(
            0,
            scrollbox.scrollHeight - viewportHeight,
          );
          if (scrollbox.scrollTop < maxScrollTop) {
            scrollbox.scrollTo({ x: 0, y: scrollbox.scrollHeight });
          }
        }
      }
    }
    if (event.name === "escape" && isStreaming) {
      stop();
      setWasInterrupted(true);
    }
    if (input === "c" && event.ctrl) {
      stop();
      exit();
    }
    if (input === "o" && event.ctrl) {
      toggleExpanded();
    }
    if (input === "t" && event.ctrl) {
      toggleTodoView();
    }
  });

  useEffect(() => {
    if (options?.initialPrompt) {
      sendMessage({ text: options.initialPrompt });
    }
  }, []); // oxlint-disable-line exhaustive-deps -- intentionally run only on mount

  const handleSubmit = useCallback(
    (prompt: string, files?: FileUIPart[]) => {
      if (!isStreaming) {
        sendMessage({ text: prompt, files });
      }
    },
    [isStreaming, sendMessage],
  );

  // Load sessions when resume panel opens
  const loadSessions = useCallback(async () => {
    if (!state.projectPath) {
      setSessions([]);
      return;
    }
    try {
      const sessionList = await listSessions(state.projectPath);
      setSessions(sessionList);
      setResumeError(null);
    } catch {
      setResumeError("Failed to load sessions");
      setSessions([]);
    }
  }, [state.projectPath]);

  // Handle session selection from resume panel
  const handleSessionSelect = useCallback(
    async (selectedSessionId: string) => {
      if (!state.projectPath) {
        closePanel();
        return;
      }

      try {
        const sessionData = await loadSession(
          state.projectPath,
          selectedSessionId,
        );
        if (!sessionData) {
          setResumeError("Session not found");
          return;
        }

        setMessages(sessionData.messages);
        setSessionId(selectedSessionId);
        closePanel();
      } catch {
        setResumeError("Failed to load session");
      }
    },
    [state.projectPath, setMessages, setSessionId, closePanel],
  );

  const handleCommandSelect = useCallback(
    (action: SlashCommandAction) => {
      // Skills are handled in InputBox by submitting as message, not here
      if (typeof action === "object") return;

      switch (action) {
        case "open-model-select":
          openPanel({ type: "model-select" });
          break;
        case "open-resume":
          loadSessions();
          openPanel({ type: "resume" });
          break;
        case "new-chat":
          setMessages([]);
          setSessionId(null);
          resetUsage();
          break;
      }
    },
    [openPanel, loadSessions, setMessages, setSessionId, resetUsage],
  );

  const formatContextLimit = useCallback((tokens: number) => {
    if (tokens >= 1_000_000) {
      return `${Math.round(tokens / 1_000_000)}m`;
    }
    if (tokens >= 1000) {
      return `${Math.round(tokens / 1000)}k`;
    }
    return String(tokens);
  }, []);

  // Memoize model options to prevent re-renders in SettingsPanel
  const modelOptions = useMemo(
    () =>
      state.availableModels.map((model) => {
        const metaParts: string[] = [];
        if (model.pricing) {
          metaParts.push(
            `${model.pricing.input} in · ${model.pricing.output} out`,
          );
        }
        if (typeof model.contextLimit === "number") {
          metaParts.push(`${formatContextLimit(model.contextLimit)} ctx`);
        }
        return {
          id: model.id,
          name: model.name,
          meta: metaParts.length > 0 ? metaParts.join(" · ") : undefined,
        };
      }),
    [formatContextLimit, state.availableModels],
  );

  // Memoize model selection handler to prevent re-renders
  const handleModelSelect = useCallback(
    (id: string) => {
      updateSettings({ modelId: id });
      closePanel();
    },
    [updateSettings, closePanel],
  );

  // Show message list with either approval panel or input box at bottom
  return (
    <box
      flexDirection="column"
      paddingTop={0.5}
      paddingBottom={0.5}
      paddingLeft={1}
      paddingRight={1}
      position="relative"
    >
      {clipboardNotice && <ClipboardToast notice={clipboardNotice} />}
      <scrollbox
        scrollY
        stickyScroll
        stickyStart="bottom"
        flexGrow={1}
        verticalScrollbarOptions={{ visible: false }}
        horizontalScrollbarOptions={{ visible: false }}
        ref={scrollboxRef}
      >
        <box flexDirection="column">
          <Header
            name={options?.header?.name}
            version={options?.header?.version}
            model={
              state.settings.modelId ??
              options?.header?.model ??
              defaultModelLabel
            }
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

          {state.activePanel.type === "model-select" && (
            <SettingsPanel
              title="Select model"
              description="Choose the AI model for this session"
              options={modelOptions}
              currentId={state.settings.modelId ?? ""}
              onSelect={handleModelSelect}
              onCancel={closePanel}
            />
          )}

          {state.activePanel.type === "resume" && (
            <>
              {resumeError && (
                <box marginBottom={1}>
                  <text fg="red">{resumeError}</text>
                </box>
              )}
              <ResumePanel
                sessions={sessions}
                currentBranch={state.currentBranch}
                onSelect={handleSessionSelect}
                onCancel={closePanel}
              />
            </>
          )}

          {state.activePanel.type === "none" &&
          hasPendingQuestion &&
          pendingQuestionPart &&
          questionToolCallId ? (
            <QuestionPanel
              questions={pendingQuestionPart.input.questions}
              onSubmit={handleQuestionSubmit}
              onCancel={handleQuestionCancel}
            />
          ) : state.activePanel.type === "none" &&
            hasPendingApproval &&
            activeApprovalId &&
            approvalInfo &&
            pendingToolPart ? (
            <ApprovalPanel
              approvalId={activeApprovalId}
              toolType={approvalInfo.toolType}
              toolCommand={approvalInfo.toolCommand}
              toolDescription={approvalInfo.toolDescription}
              dontAskAgainPattern={approvalInfo.dontAskAgainPattern}
              toolPart={pendingToolPart}
            />
          ) : state.activePanel.type === "none" ? (
            <>
              {isStreaming && <StreamingStatusBar messages={messages} />}

              {!isStreaming && todos && todos.length > 0 && (
                <StandaloneTodoList
                  todos={todos}
                  isTodoVisible={isTodoVisible}
                />
              )}

              {!isExpanded && (
                <InputBox
                  onSubmit={handleSubmit}
                  autoAcceptMode={state.autoAcceptMode}
                  onToggleAutoAccept={cycleAutoAcceptMode}
                  onCommandSelect={handleCommandSelect}
                  disabled={isStreaming}
                  inputTokens={state.usage.inputTokens ?? 0}
                  contextLimit={state.contextLimit}
                  pasteCollapseLineThreshold={pasteCollapseLineThreshold}
                />
              )}
            </>
          ) : null}

          {isExpanded && <ExpandedViewIndicator />}
        </box>
      </scrollbox>
    </box>
  );
}

export function App({ options }: AppProps) {
  return <AppContent options={options} />;
}
