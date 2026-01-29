import type { TodoItem } from "@open-harness/agent";
import type { ThinkingState } from "@open-harness/shared";
import { TextAttributes } from "@opentui/core";
import React, { useEffect, useState } from "react";
import { PRIMARY_COLOR, PRIMARY_COLOR_BRIGHT } from "../lib/colors";

const SILLY_WORDS = [
  "Thinking",
  "Pondering",
  "Cogitating",
  "Ruminating",
  "Mulling",
  "Noodling",
  "Smooshing",
  "Percolating",
  "Marinating",
  "Simmering",
  "Brewing",
  "Conjuring",
  "Manifesting",
  "Vibing",
  "Channeling",
];
const SILLY_WORD_INTERVAL = 4000;
const PULSE_SPEED = 100;

function useSillyWord() {
  const [index, setIndex] = useState(() =>
    Math.floor(Math.random() * SILLY_WORDS.length),
  );
  const [pulsePosition, setPulsePosition] = useState(0);
  const currentWord = SILLY_WORDS[index] ?? "Thinking";
  const wordLength = currentWord.length;

  // Pulse animation - moves highlight from left to right
  useEffect(() => {
    const timer = setInterval(() => {
      setPulsePosition((prev) => (prev + 1) % (wordLength + 2));
    }, PULSE_SPEED);
    return () => clearInterval(timer);
  }, [wordLength]);

  // Change word at interval
  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % SILLY_WORDS.length);
      setPulsePosition(0);
    }, SILLY_WORD_INTERVAL);
    return () => clearInterval(timer);
  }, []);

  return { word: currentWord, pulsePosition };
}

function PulsedWord({
  word,
  pulsePosition,
}: {
  word: string;
  pulsePosition: number;
}) {
  return (
    <>
      {word.split("").map((char, i) => {
        const distance = Math.abs(i - pulsePosition);
        const isBright = distance === 0;
        const isMedium = distance === 1;
        let attributes = 0;
        if (isBright) attributes |= TextAttributes.BOLD;
        if (!isBright && !isMedium) attributes |= TextAttributes.DIM;
        const resolvedAttributes = attributes === 0 ? undefined : attributes;

        return (
          <text
            key={i}
            fg={isBright ? PRIMARY_COLOR_BRIGHT : PRIMARY_COLOR}
            attributes={resolvedAttributes}
          >
            {char}
          </text>
        );
      })}
    </>
  );
}

type StatusBarProps = {
  isStreaming: boolean;
  status?: string;
  thinkingState: ThinkingState;
  todos?: TodoItem[] | null;
  isTodoVisible?: boolean;
  inputTokens?: number | null;
};

function getThinkingMeta(thinkingState: ThinkingState): string {
  if (thinkingState.thinkingDuration !== null) {
    return `thought for ${thinkingState.thinkingDuration}s`;
  }
  if (thinkingState.isThinking) {
    return "thinking";
  }
  return "";
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return tokens.toString();
}

// Status indicator - not memoized to allow animation
function StatusIndicator({
  isStreaming,
  thinkingState,
  inputTokens,
}: {
  isStreaming: boolean;
  thinkingState: ThinkingState;
  inputTokens?: number | null;
}) {
  const { word, pulsePosition } = useSillyWord();

  // Determine prefix: + while streaming/thinking not done, * when thinking completed
  const hasThinkingCompleted = thinkingState.thinkingDuration !== null;
  const prefix = hasThinkingCompleted ? "*" : "+";

  // Build the meta text
  const thinkingMeta = getThinkingMeta(thinkingState);
  const tokensMeta = inputTokens ? `${formatTokens(inputTokens)} tokens` : "";
  const metaParts = [thinkingMeta, tokensMeta].filter(Boolean).join(" · ");
  const metaText = metaParts
    ? `(esc to interrupt · ${metaParts})`
    : "(esc to interrupt)";

  if (isStreaming) {
    return (
      <>
        <text fg={PRIMARY_COLOR}>{prefix} </text>
        <PulsedWord word={word} pulsePosition={pulsePosition} />
        <text fg="gray">...</text>
        <text fg="gray"> {metaText}</text>
      </>
    );
  }
  return <text fg="green">✓ Done</text>;
}

function getTodoIcon(status: TodoItem["status"]): string {
  switch (status) {
    case "completed":
      return "☒";
    case "in_progress":
      return "◎";
    case "pending":
    default:
      return "☐";
  }
}

function getTodoColor(status: TodoItem["status"]): string {
  switch (status) {
    case "completed":
      return "gray";
    case "in_progress":
      return PRIMARY_COLOR;
    case "pending":
    default:
      return "white";
  }
}

function TodoList({ todos }: { todos: TodoItem[] }) {
  return (
    <box flexDirection="column" marginLeft={2}>
      {todos.map((todo) => (
        <box key={todo.id} flexDirection="row">
          <text fg={getTodoColor(todo.status)}>
            {getTodoIcon(todo.status)}{" "}
            {todo.status === "completed" ? (
              <span attributes={TextAttributes.STRIKETHROUGH}>
                {todo.content}
              </span>
            ) : (
              todo.content
            )}
          </text>
        </box>
      ))}
    </box>
  );
}

// Standalone todo list for when not streaming
export function StandaloneTodoList({
  todos,
  isTodoVisible,
}: {
  todos: TodoItem[];
  isTodoVisible: boolean;
}) {
  const hasIncompleteTodos = todos.some((t) => t.status !== "completed");

  if (!hasIncompleteTodos || !isTodoVisible) {
    return null;
  }

  return (
    <box flexDirection="column" marginTop={1}>
      <box flexDirection="row">
        <text fg="gray">Todo List</text>
        <text fg="gray"> · ctrl+t to hide</text>
      </box>
      <TodoList todos={todos} />
    </box>
  );
}

// Not memoized to allow animation
export function StatusBar({
  isStreaming,
  status,
  thinkingState,
  todos,
  isTodoVisible = true,
  inputTokens,
}: StatusBarProps) {
  const hasTodos = todos && todos.length > 0;
  const hasIncompleteTodos =
    hasTodos && todos.some((t) => t.status !== "completed");
  const showTodos = isTodoVisible && hasIncompleteTodos;

  if (!isStreaming && !status && !showTodos) {
    return null;
  }

  const todoHint =
    hasTodos && hasIncompleteTodos
      ? ` · ctrl+t to ${isTodoVisible ? "hide" : "show"} todos`
      : "";

  return (
    <box flexDirection="column" marginTop={1}>
      <box flexDirection="row">
        <StatusIndicator
          isStreaming={isStreaming}
          thinkingState={thinkingState}
          inputTokens={inputTokens}
        />
        {hasTodos && <text fg="gray">{todoHint}</text>}
      </box>
      {showTodos && <TodoList todos={todos} />}
    </box>
  );
}
