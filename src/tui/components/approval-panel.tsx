import React, { useState, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { useChat } from "@ai-sdk/react";
import { useChatContext } from "../chat-context.js";
import type { TUIAgentUIToolPart, ApprovalRule } from "../types.js";
import { inferApprovalRule } from "./tool-call.js";

export type ApprovalPanelProps = {
  approvalId: string;
  toolType: string;
  toolCommand: string;
  toolDescription?: string;
  dontAskAgainPattern?: string;
  toolPart?: TUIAgentUIToolPart;
};

export function ApprovalPanel({
  approvalId,
  toolType,
  toolCommand,
  toolDescription,
  dontAskAgainPattern,
  toolPart,
}: ApprovalPanelProps) {
  const { chat, state, addApprovalRule } = useChatContext();
  const { addToolApprovalResponse } = useChat({ chat });

  // Infer the approval rule from the tool part
  const inferredRule = useMemo((): ApprovalRule | null => {
    if (!toolPart) return null;
    return inferApprovalRule(toolPart, state.workingDirectory);
  }, [toolPart, state.workingDirectory]);
  // Determine available options based on whether a rule can be inferred
  const canSaveRule = inferredRule !== null;
  const maxOption = canSaveRule ? 2 : 1; // 0=Yes, 1=Don't ask again (if available), last=reason

  const [selected, setSelected] = useState(0);
  const [reason, setReason] = useState("");

  // Reset state when approval request changes
  useEffect(() => {
    setSelected(0);
    setReason("");
  }, [approvalId]);

  // Determine which "logical" option is selected based on available options
  // When canSaveRule: 0=Yes, 1=Don't ask again, 2=Reason
  // When !canSaveRule: 0=Yes, 1=Reason (skip "don't ask again")
  const reasonOptionIndex = canSaveRule ? 2 : 1;

  useInput((input, key) => {
    // Handle escape to cancel (deny without reason)
    if (key.escape) {
      addToolApprovalResponse({ id: approvalId, approved: false });
      return;
    }

    // When on the text input option (reason)
    if (selected === reasonOptionIndex) {
      if (key.return) {
        addToolApprovalResponse({
          id: approvalId,
          approved: false,
          reason: reason.trim() || undefined,
        });
      } else if (key.backspace || key.delete) {
        setReason((prev) => prev.slice(0, -1));
      } else if (key.upArrow || (key.ctrl && input === "p")) {
        setSelected(reasonOptionIndex - 1);
      } else if (input && !key.ctrl && !key.meta && !key.return) {
        setReason((prev) => prev + input);
      }
      return;
    }

    const goUp = key.upArrow || input === "k" || (key.ctrl && input === "p");
    const goDown =
      key.downArrow || input === "j" || (key.ctrl && input === "n");

    if (goUp) {
      setSelected((prev) => (prev === 0 ? reasonOptionIndex : prev - 1));
    }
    if (goDown) {
      setSelected((prev) => (prev === reasonOptionIndex ? 0 : prev + 1));
    }
    if (key.return) {
      if (selected === 0) {
        // Yes
        addToolApprovalResponse({ id: approvalId, approved: true });
      } else if (canSaveRule && selected === 1) {
        // Yes, and don't ask again - add the rule then approve
        addApprovalRule(inferredRule!);
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
      {/* Tool type header */}
      <Text color="blueBright" bold>
        {toolType}
      </Text>

      {/* Command and description */}
      <Box flexDirection="column" marginTop={1} marginLeft={2}>
        <Text>{toolCommand}</Text>
        {toolDescription && <Text color="gray">{toolDescription}</Text>}
      </Box>

      {/* Question and options */}
      <Box flexDirection="column" marginTop={1}>
        <Text>Do you want to proceed?</Text>
        <Box flexDirection="column" marginTop={1}>
          {/* Option 1: Yes */}
          <Text>
            <Text color="yellow">{selected === 0 ? "› " : "  "}</Text>
            <Text color={selected === 0 ? "yellow" : undefined}>1. Yes</Text>
          </Text>

          {/* Option 2: Yes, and don't ask again (only if rule can be inferred) */}
          {canSaveRule && (
            <Text>
              <Text color="yellow">{selected === 1 ? "› " : "  "}</Text>
              <Text color={selected === 1 ? "yellow" : undefined}>
                2. Yes, and don't ask again for{" "}
              </Text>
              <Text color={selected === 1 ? "yellow" : undefined} bold>
                {dontAskAgainPattern}
              </Text>
            </Text>
          )}

          {/* Option 3 (or 2 if no rule): Inline text input */}
          <Box>
            <Text color="yellow">{selected === reasonOptionIndex ? "› " : "  "}</Text>
            <Text color={selected === reasonOptionIndex ? "yellow" : undefined}>
              {canSaveRule ? "3" : "2"}.{" "}
            </Text>
            {reason || selected === reasonOptionIndex ? (
              <>
                <Text color={selected === reasonOptionIndex ? "yellow" : undefined}>
                  {reason}
                </Text>
                {selected === reasonOptionIndex && <Text color="gray">█</Text>}
              </>
            ) : (
              <Text color="gray">
                Type here to tell Claude what to do differently
              </Text>
            )}
          </Box>
        </Box>
      </Box>

      {/* Footer hint */}
      <Box marginTop={1}>
        <Text color="gray">
          {selected === reasonOptionIndex ? "Enter to submit, Esc to cancel" : "Esc to cancel"}
        </Text>
      </Box>
    </Box>
  );
}
