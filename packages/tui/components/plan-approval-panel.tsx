import React, { useState, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { useChat } from "@ai-sdk/react";
import { readFile } from "fs/promises";
import { useChatContext } from "../chat-context";
import { renderMarkdown } from "../lib/markdown";

export type PlanApprovalPanelProps = {
  approvalId: string;
  planFilePath: string;
  onClearAndImplement?: (planFilePath: string) => void;
};

export function PlanApprovalPanel({
  approvalId,
  planFilePath,
  onClearAndImplement,
}: PlanApprovalPanelProps) {
  const { chat, setPermissionMode } = useChatContext();
  const { addToolApprovalResponse } = useChat({ chat });

  const [selected, setSelected] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [plan, setPlan] = useState<string | null>(null);

  // Read plan file content
  useEffect(() => {
    readFile(planFilePath, "utf-8")
      .then((content) => setPlan(content))
      .catch(() => setPlan(null));
  }, [planFilePath]);

  // Reset state when approval request changes
  useEffect(() => {
    setSelected(0);
    setFeedback("");
  }, [approvalId]);

  const renderedPlan = useMemo(() => {
    if (!plan) return null;
    return renderMarkdown(plan);
  }, [plan]);

  // Options:
  // 0: Yes, clear context and auto-accept edits (shift+tab)
  // 1: Yes, auto-accept edits
  // 2: Yes, manually approve edits
  // 3: Type feedback (text input)
  const feedbackOptionIndex = 3;

  useInput((input, key) => {
    // Handle escape to cancel
    if (key.escape) {
      addToolApprovalResponse({ id: approvalId, approved: false });
      return;
    }

    // Shift+Tab shortcut for option 0 (clear context and implement)
    if (key.shift && key.tab) {
      if (onClearAndImplement) {
        onClearAndImplement(planFilePath);
      }
      return;
    }

    // When on text input option
    if (selected === feedbackOptionIndex) {
      if (key.return && feedback.trim()) {
        addToolApprovalResponse({
          id: approvalId,
          approved: false,
          reason: feedback.trim(),
        });
      } else if (key.backspace || key.delete) {
        setFeedback((prev) => prev.slice(0, -1));
      } else if (key.upArrow || (key.ctrl && input === "p")) {
        setSelected(feedbackOptionIndex - 1);
      } else if (input && !key.ctrl && !key.meta && !key.return) {
        setFeedback((prev) => prev + input);
      }
      return;
    }

    const goUp = key.upArrow || input === "k" || (key.ctrl && input === "p");
    const goDown =
      key.downArrow || input === "j" || (key.ctrl && input === "n");

    if (goUp) {
      setSelected((prev) => (prev === 0 ? feedbackOptionIndex : prev - 1));
    }
    if (goDown) {
      setSelected((prev) => (prev === feedbackOptionIndex ? 0 : prev + 1));
    }

    if (key.return) {
      if (selected === 0) {
        // Yes, clear context and auto-accept edits
        if (onClearAndImplement) {
          onClearAndImplement(planFilePath);
        }
      } else if (selected === 1) {
        // Yes, auto-accept edits
        setPermissionMode("edits");
        addToolApprovalResponse({ id: approvalId, approved: true });
      } else if (selected === 2) {
        // Yes, manually approve edits
        setPermissionMode("default");
        addToolApprovalResponse({ id: approvalId, approved: true });
      }
    }
  });

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="single"
      borderTop
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderColor="gray"
      paddingTop={1}
    >
      {/* Header */}
      <Text color="blueBright" bold>
        Ready to code?
      </Text>

      <Box marginTop={1}>
        <Text>Here is Claude's plan:</Text>
      </Box>

      {/* Plan content */}
      {renderedPlan && (
        <Box
          flexDirection="column"
          marginTop={1}
          marginLeft={2}
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          paddingY={1}
        >
          <Text>{renderedPlan}</Text>
        </Box>
      )}

      {!renderedPlan && (
        <Box marginTop={1} marginLeft={2}>
          <Text color="gray">(No plan content)</Text>
        </Box>
      )}

      {/* Options */}
      <Box flexDirection="column" marginTop={1}>
        <Text>Would you like to proceed?</Text>
        <Box flexDirection="column" marginTop={1}>
          {/* Option 1 */}
          <Text>
            <Text color="yellow">{selected === 0 ? "> " : "  "}</Text>
            <Text color={selected === 0 ? "yellow" : undefined}>
              1. Yes, clear context and auto-accept edits
            </Text>
            <Text color="gray"> (shift+tab)</Text>
          </Text>

          {/* Option 2 */}
          <Text>
            <Text color="yellow">{selected === 1 ? "> " : "  "}</Text>
            <Text color={selected === 1 ? "yellow" : undefined}>
              2. Yes, auto-accept edits
            </Text>
          </Text>

          {/* Option 3 */}
          <Text>
            <Text color="yellow">{selected === 2 ? "> " : "  "}</Text>
            <Text color={selected === 2 ? "yellow" : undefined}>
              3. Yes, manually approve edits
            </Text>
          </Text>

          {/* Option 4: Text input */}
          <Box>
            <Text color="yellow">
              {selected === feedbackOptionIndex ? "> " : "  "}
            </Text>
            <Text
              color={selected === feedbackOptionIndex ? "yellow" : undefined}
            >
              4.{" "}
            </Text>
            {feedback || selected === feedbackOptionIndex ? (
              <>
                <Text
                  color={
                    selected === feedbackOptionIndex ? "yellow" : undefined
                  }
                >
                  {feedback}
                </Text>
                {selected === feedbackOptionIndex && (
                  <Text color="gray">|</Text>
                )}
              </>
            ) : (
              <Text color="gray">Type here to tell Claude what to change</Text>
            )}
          </Box>
        </Box>
      </Box>

      {/* Footer hint */}
      <Box marginTop={1}>
        <Text color="gray">ctrl-g to edit in Nvim · {planFilePath}</Text>
      </Box>
    </Box>
  );
}
