import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { ThinkingState } from "../reasoning-context.js";
import type { TodoItem } from "../../agent/types.js";

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

        return (
          <Text
            key={i}
            color={isBright ? "yellowBright" : "yellow"}
            bold={isBright}
            dimColor={!isBright && !isMedium}
          >
            {char}
          </Text>
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
        <Text color="yellow">{prefix} </Text>
        <PulsedWord word={word} pulsePosition={pulsePosition} />
        <Text color="gray">...</Text>
        <Text color="gray"> {metaText}</Text>
      </>
    );
  }
  return <Text color="green">✓ Done</Text>;
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
      return "yellow";
    case "pending":
    default:
      return "white";
  }
}

function TodoList({ todos }: { todos: TodoItem[] }) {
  return (
    <Box flexDirection="column" marginLeft={2}>
      {todos.map((todo) => (
        <Box key={todo.id}>
          <Text color={getTodoColor(todo.status)}>
            {getTodoIcon(todo.status)}{" "}
            {todo.status === "completed" ? (
              <Text strikethrough>{todo.content}</Text>
            ) : (
              todo.content
            )}
          </Text>
        </Box>
      ))}
    </Box>
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
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color="gray">Todo List</Text>
        <Text color="gray"> · ctrl+t to hide</Text>
      </Box>
      <TodoList todos={todos} />
    </Box>
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
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <StatusIndicator
          isStreaming={isStreaming}
          thinkingState={thinkingState}
          inputTokens={inputTokens}
        />
        {hasTodos && <Text color="gray">{todoHint}</Text>}
      </Box>
      {showTodos && <TodoList todos={todos} />}
    </Box>
  );
}
