/**
 * Approval buttons component for tool approval UI.
 * This is kept separate from tool-call.tsx as it's tightly coupled to chat context.
 */

import { useChat } from "@ai-sdk/react";
import { useKeyboard } from "@opentui/react";
import React, { useState } from "react";
import { useChatContext } from "../chat-context";
import { inputFromKey, isReturnKey } from "../lib/keyboard";

export function ApprovalButtons({ approvalId }: { approvalId: string }) {
  const { chat } = useChatContext();
  const { addToolApprovalResponse } = useChat({
    chat,
  });
  const [selected, setSelected] = useState(0);
  const [isTypingReason, setIsTypingReason] = useState(false);
  const [reason, setReason] = useState("");

  useKeyboard((event) => {
    const input = inputFromKey(event);
    if (isTypingReason) {
      if (event.name === "escape") {
        setIsTypingReason(false);
        setReason("");
      } else if (isReturnKey(event) && reason.trim()) {
        addToolApprovalResponse({
          id: approvalId,
          approved: false,
          reason: reason.trim(),
        });
      } else if (event.name === "backspace" || event.name === "delete") {
        setReason((prev) => prev.slice(0, -1));
      } else if (input && !event.ctrl && !event.meta) {
        setReason((prev) => prev + input);
      }
      return;
    }

    const goUp =
      event.name === "up" || input === "k" || (event.ctrl && input === "p");
    const goDown =
      event.name === "down" || input === "j" || (event.ctrl && input === "n");
    if (goUp) {
      setSelected((prev) => (prev === 0 ? 2 : prev - 1));
    }
    if (goDown) {
      setSelected((prev) => (prev === 2 ? 0 : prev + 1));
    }
    if (isReturnKey(event)) {
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
    <box flexDirection="column" marginTop={1} marginLeft={2}>
      <text>Do you want to proceed?</text>
      <box flexDirection="column" marginTop={1}>
        <text>
          {selected === 0 ? "> " : "  "}
          <span fg={selected === 0 ? "green" : undefined}>1. Yes</span>
        </text>
        <text>
          {selected === 1 ? "> " : "  "}
          <span fg={selected === 1 ? "red" : undefined}>2. No</span>
        </text>
        <text>
          {selected === 2 ? "> " : "  "}
          <span fg={selected === 2 ? "cyan" : undefined}>
            3. Type here to tell the agent what to do differently
          </span>
        </text>
      </box>
      {isTypingReason && (
        <box marginTop={1} marginLeft={2}>
          <text fg="cyan">Reason: </text>
          <text>{reason}</text>
          <text fg="gray">█</text>
        </box>
      )}
      <box marginTop={1}>
        <text fg="gray">
          {isTypingReason ? "Enter to submit, Esc to cancel" : "Esc to cancel"}
        </text>
      </box>
    </box>
  );
}
