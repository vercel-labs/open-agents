/**
 * Approval buttons component for tool approval UI.
 * This is kept separate from tool-call.tsx as it's tightly coupled to chat context.
 */
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useChat } from "@ai-sdk/react";
import { useChatContext } from "../chat-context.js";

export function ApprovalButtons({ approvalId }: { approvalId: string }) {
  const { chat } = useChatContext();
  const { addToolApprovalResponse } = useChat({
    chat,
  });
  const [selected, setSelected] = useState(0);
  const [isTypingReason, setIsTypingReason] = useState(false);
  const [reason, setReason] = useState("");

  useInput((input, key) => {
    if (isTypingReason) {
      if (key.escape) {
        setIsTypingReason(false);
        setReason("");
      } else if (key.return && reason.trim()) {
        addToolApprovalResponse({
          id: approvalId,
          approved: false,
          reason: reason.trim(),
        });
      } else if (key.backspace || key.delete) {
        setReason((prev) => prev.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setReason((prev) => prev + input);
      }
      return;
    }

    const goUp = key.upArrow || input === "k" || (key.ctrl && input === "p");
    const goDown =
      key.downArrow || input === "j" || (key.ctrl && input === "n");
    if (goUp) {
      setSelected((prev) => (prev === 0 ? 2 : prev - 1));
    }
    if (goDown) {
      setSelected((prev) => (prev === 2 ? 0 : prev + 1));
    }
    if (key.return) {
      if (selected === 0) {
        addToolApprovalResponse({ id: approvalId, approved: true });
      } else if (selected === 1) {
        addToolApprovalResponse({ id: approvalId, approved: false });
      } else if (selected === 2) {
        setIsTypingReason(true);
      }
    }
  });

  return (
    <Box flexDirection="column" marginTop={1} marginLeft={2}>
      <Text>Do you want to proceed?</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text>
          {selected === 0 ? "> " : "  "}
          <Text color={selected === 0 ? "green" : undefined}>1. Yes</Text>
        </Text>
        <Text>
          {selected === 1 ? "> " : "  "}
          <Text color={selected === 1 ? "red" : undefined}>2. No</Text>
        </Text>
        <Text>
          {selected === 2 ? "> " : "  "}
          <Text color={selected === 2 ? "cyan" : undefined}>
            3. Type here to tell the agent what to do differently
          </Text>
        </Text>
      </Box>
      {isTypingReason && (
        <Box marginTop={1} marginLeft={2}>
          <Text color="cyan">Reason: </Text>
          <Text>{reason}</Text>
          <Text color="gray">█</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="gray">
          {isTypingReason ? "Enter to submit, Esc to cancel" : "Esc to cancel"}
        </Text>
      </Box>
    </Box>
  );
}
