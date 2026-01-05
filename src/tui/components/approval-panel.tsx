import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { useChat } from "@ai-sdk/react";
import { useChatContext } from "../chat-context.js";

export type ApprovalPanelProps = {
  approvalId: string;
  toolType: string;
  toolCommand: string;
  toolDescription?: string;
  dontAskAgainPattern?: string;
};

export function ApprovalPanel({
  approvalId,
  toolType,
  toolCommand,
  toolDescription,
  dontAskAgainPattern,
}: ApprovalPanelProps) {
  const { chat } = useChatContext();
  const { addToolApprovalResponse } = useChat({ chat });
  const [selected, setSelected] = useState(0);
  const [reason, setReason] = useState("");

  // Reset state when approval request changes
  useEffect(() => {
    setSelected(0);
    setReason("");
  }, [approvalId]);

  useInput((input, key) => {
    // Handle escape to cancel (deny without reason)
    if (key.escape) {
      addToolApprovalResponse({ id: approvalId, approved: false });
      return;
    }

    // When on the text input option (selected === 2)
    if (selected === 2) {
      if (key.return) {
        addToolApprovalResponse({
          id: approvalId,
          approved: false,
          reason: reason.trim() || undefined,
        });
      } else if (key.backspace || key.delete) {
        setReason((prev) => prev.slice(0, -1));
      } else if (key.upArrow || (key.ctrl && input === "p")) {
        setSelected(1);
      } else if (input && !key.ctrl && !key.meta && !key.return) {
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
        // Yes
        addToolApprovalResponse({ id: approvalId, approved: true });
      } else if (selected === 1) {
        // Yes, and don't ask again (placeholder - behaves as Yes for now)
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

          {/* Option 2: Yes, and don't ask again */}
          <Text>
            <Text color="yellow">{selected === 1 ? "› " : "  "}</Text>
            <Text color={selected === 1 ? "yellow" : undefined}>
              2. Yes, and don't ask again for{" "}
            </Text>
            <Text color={selected === 1 ? "yellow" : undefined} bold>
              {dontAskAgainPattern}
            </Text>
          </Text>

          {/* Option 3: Inline text input */}
          <Box>
            <Text color="yellow">{selected === 2 ? "› " : "  "}</Text>
            <Text color={selected === 2 ? "yellow" : undefined}>3. </Text>
            {reason || selected === 2 ? (
              <>
                <Text color={selected === 2 ? "yellow" : undefined}>
                  {reason}
                </Text>
                {selected === 2 && <Text color="gray">█</Text>}
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
          {selected === 2 ? "Enter to submit, Esc to cancel" : "Esc to cancel"}
        </Text>
      </Box>
    </Box>
  );
}
