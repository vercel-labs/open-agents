import React, { useState, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { useChat } from "@ai-sdk/react";
import {
  createNewFileCodeLines,
  createEditDiffLines,
  DIFF_LINE_MAX_WIDTH,
  type CodeLine,
  type DiffLine,
} from "@open-harness/shared";
import { useChatContext } from "../chat-context";
import type { TUIAgentUIToolPart, ApprovalRule } from "../types";
import { inferApprovalRule } from "../lib/approval";
import { cliHighlighter } from "../lib/highlighter";

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
  const { chat, state, addPendingApprovalRule } = useChatContext();
  const { addToolApprovalResponse } = useChat({ chat });

  // Infer the approval rule from the tool part
  const inferredRule = useMemo((): ApprovalRule | null => {
    if (!toolPart) return null;
    return inferApprovalRule(toolPart, state.workingDirectory);
  }, [toolPart, state.workingDirectory]);

  // For skill tools, look up the actual skill description
  const effectiveDescription = useMemo(() => {
    if (toolPart?.type === "tool-skill") {
      const skillName = String(toolPart.input?.skill ?? "");
      const skill = state.skills.find(
        (s) => s.name.toLowerCase() === skillName.toLowerCase(),
      );
      if (skill?.description) {
        return skill.description;
      }
    }
    return toolDescription;
  }, [toolPart, state.skills, toolDescription]);

  // Determine available options based on whether a rule can be inferred
  const canSaveRule = inferredRule !== null;

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

  // Generate preview info for write or edit operations
  const previewInfo = useMemo(():
    | {
        type: "newFile";
        lines: CodeLine[];
        totalLines: number;
        hiddenLines: number;
      }
    | { type: "edit"; lines: DiffLine[]; additions: number; removals: number }
    | null => {
    if (!toolPart) return null;

    if (toolPart.type === "tool-write") {
      const content = String(toolPart.input?.content ?? "");
      const filePath = String(toolPart.input?.filePath ?? "");
      const { lines, totalLines, hiddenLines } = createNewFileCodeLines(
        content,
        filePath,
        cliHighlighter,
      );
      return { type: "newFile", lines, totalLines, hiddenLines };
    }

    if (toolPart.type === "tool-edit") {
      const oldString = String(toolPart.input?.oldString ?? "");
      const newString = String(toolPart.input?.newString ?? "");
      const startLine = Number(toolPart.input?.startLine) || 1;
      const result = createEditDiffLines(oldString, newString, startLine);
      return { type: "edit", ...result };
    }

    return null;
  }, [toolPart]);

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
        // Yes, and don't ask again - add the rule as pending (will auto-approve parallel tools)
        addPendingApprovalRule(inferredRule!);
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
        {effectiveDescription && (
          <Text color="gray">{effectiveDescription}</Text>
        )}
      </Box>

      {/* Code preview for new files */}
      {previewInfo?.type === "newFile" && previewInfo.lines.length > 0 && (
        <Box
          flexDirection="column"
          marginTop={1}
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
        >
          {previewInfo.lines.map((line, i) => (
            <Text key={i}>{line.highlighted}</Text>
          ))}
          {previewInfo.hiddenLines > 0 && (
            <Text color="gray">
              ... {previewInfo.hiddenLines} more line
              {previewInfo.hiddenLines !== 1 ? "s" : ""}
            </Text>
          )}
        </Box>
      )}

      {/* Diff preview for edits */}
      {previewInfo?.type === "edit" && previewInfo.lines.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {previewInfo.lines.map((line, i) => (
            <Box key={i}>
              {line.type === "separator" ? (
                <Text color="gray"> {line.content}</Text>
              ) : line.type === "addition" ? (
                <Text backgroundColor="#234823">
                  {line.lineNumber !== undefined
                    ? String(line.lineNumber).padStart(3, " ")
                    : "   "}{" "}
                  +
                  {line.content
                    .slice(0, DIFF_LINE_MAX_WIDTH)
                    .padEnd(DIFF_LINE_MAX_WIDTH, " ")}
                </Text>
              ) : (
                <Text backgroundColor="#5c2626">
                  {line.lineNumber !== undefined
                    ? String(line.lineNumber).padStart(3, " ")
                    : "   "}{" "}
                  -
                  {line.content
                    .slice(0, DIFF_LINE_MAX_WIDTH)
                    .padEnd(DIFF_LINE_MAX_WIDTH, " ")}
                </Text>
              )}
            </Box>
          ))}
        </Box>
      )}

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
            <Text color="yellow">
              {selected === reasonOptionIndex ? "› " : "  "}
            </Text>
            <Text color={selected === reasonOptionIndex ? "yellow" : undefined}>
              {canSaveRule ? "3" : "2"}.{" "}
            </Text>
            {reason || selected === reasonOptionIndex ? (
              <>
                <Text
                  color={selected === reasonOptionIndex ? "yellow" : undefined}
                >
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
          {selected === reasonOptionIndex
            ? "Enter to submit, Esc to cancel"
            : "Esc to cancel"}
        </Text>
      </Box>
    </Box>
  );
}
