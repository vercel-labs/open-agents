import { useChat } from "@ai-sdk/react";
import {
  createNewFileCodeLines,
  createUnifiedDiff,
  getLanguageFromPath,
} from "@open-harness/shared";
import { TextAttributes } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import React, { useEffect, useMemo, useState } from "react";
import { useChatContext } from "../chat-context";
import { inferApprovalRule } from "../lib/approval";
import { cliSyntaxStyle, cliTreeSitterClient } from "../lib/code-theme";
import { PRIMARY_COLOR } from "../lib/colors";
import { cliHighlighter } from "../lib/highlighter";
import { inputFromKey, isReturnKey } from "../lib/keyboard";
import { truncateText } from "../lib/truncate";
import type { ApprovalRule, TUIAgentUIToolPart } from "../types";

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
  const { width } = useTerminalDimensions();
  const terminalWidth = width ?? 80;
  const contentIndent = 2;
  const maxContentWidth = Math.max(10, terminalWidth - contentIndent);

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
        content: string;
        filetype?: string;
        totalLines: number;
        hiddenLines: number;
      }
    | {
        type: "edit";
        diff: string;
        additions: number;
        removals: number;
        filetype?: string;
      }
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
      const previewContent = lines.map((line) => line.content).join("\n");
      return {
        type: "newFile",
        content: previewContent,
        filetype: getLanguageFromPath(filePath),
        totalLines,
        hiddenLines,
      };
    }

    if (toolPart.type === "tool-edit") {
      const oldString = String(toolPart.input?.oldString ?? "");
      const newString = String(toolPart.input?.newString ?? "");
      const startLine = Number(toolPart.input?.startLine) || 1;
      const filePath = String(toolPart.input?.filePath ?? "file");
      const result = createUnifiedDiff(
        oldString,
        newString,
        filePath,
        startLine,
      );
      return {
        type: "edit",
        diff: result.diff,
        additions: result.additions,
        removals: result.removals,
        filetype: getLanguageFromPath(filePath),
      };
    }

    return null;
  }, [toolPart]);

  useKeyboard((event) => {
    const input = inputFromKey(event);
    // Handle escape to cancel (deny without reason)
    if (event.name === "escape") {
      addToolApprovalResponse({ id: approvalId, approved: false });
      return;
    }

    // When on the text input option (reason)
    if (selected === reasonOptionIndex) {
      if (isReturnKey(event)) {
        addToolApprovalResponse({
          id: approvalId,
          approved: false,
          reason: reason.trim() || undefined,
        });
      } else if (event.name === "backspace" || event.name === "delete") {
        setReason((prev) => prev.slice(0, -1));
      } else if (event.name === "up" || (event.ctrl && input === "p")) {
        setSelected(reasonOptionIndex - 1);
      } else if (input && !event.ctrl && !event.meta && !isReturnKey(event)) {
        setReason((prev) => prev + input);
      }
      return;
    }

    const goUp =
      event.name === "up" || input === "k" || (event.ctrl && input === "p");
    const goDown =
      event.name === "down" || input === "j" || (event.ctrl && input === "n");

    if (goUp) {
      setSelected((prev) => (prev === 0 ? reasonOptionIndex : prev - 1));
    }
    if (goDown) {
      setSelected((prev) => (prev === reasonOptionIndex ? 0 : prev + 1));
    }
    if (isReturnKey(event)) {
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
    <box
      flexDirection="column"
      marginTop={1}
      borderStyle="single"
      border={["top"]}
      borderColor="gray"
      paddingTop={1}
    >
      {/* Tool type header */}
      <text fg="brightBlue" attributes={TextAttributes.BOLD}>
        {toolType}
      </text>

      {/* Command and description */}
      <box flexDirection="column" marginTop={1} marginLeft={2}>
        <text>{truncateText(toolCommand, maxContentWidth)}</text>
        {effectiveDescription && (
          <text fg="gray">
            {truncateText(effectiveDescription, maxContentWidth)}
          </text>
        )}
      </box>

      {/* Code preview for new files */}
      {previewInfo?.type === "newFile" && previewInfo.content.length > 0 && (
        <box
          flexDirection="column"
          marginTop={1}
          borderStyle="rounded"
          borderColor="gray"
          paddingLeft={1}
          paddingRight={1}
        >
          <code
            content={previewInfo.content}
            filetype={previewInfo.filetype}
            syntaxStyle={cliSyntaxStyle}
            treeSitterClient={cliTreeSitterClient}
            width="100%"
          />
          {previewInfo.hiddenLines > 0 && (
            <text fg="gray">
              ... {previewInfo.hiddenLines} more line
              {previewInfo.hiddenLines !== 1 ? "s" : ""}
            </text>
          )}
        </box>
      )}

      {/* Diff preview for edits */}
      {previewInfo?.type === "edit" &&
        previewInfo.additions + previewInfo.removals > 0 && (
          <box flexDirection="column" marginTop={1}>
            <diff
              diff={previewInfo.diff}
              filetype={previewInfo.filetype}
              syntaxStyle={cliSyntaxStyle}
              treeSitterClient={cliTreeSitterClient}
              view="unified"
              wrapMode="char"
              showLineNumbers={true}
              lineNumberFg="#6b7280"
              addedBg="#244d32"
              removedBg="#4f2626"
              addedLineNumberBg="#244d32"
              removedLineNumberBg="#4f2626"
              addedSignColor="#7ee787"
              removedSignColor="#ff7b72"
              width="100%"
            />
          </box>
        )}

      {/* Question and options */}
      <box flexDirection="column" marginTop={1}>
        <text>Do you want to proceed?</text>
        <box flexDirection="column" marginTop={1}>
          {/* Option 1: Yes */}
          <text>
            <span fg={PRIMARY_COLOR}>{selected === 0 ? "› " : "  "}</span>
            <span fg={selected === 0 ? PRIMARY_COLOR : undefined}>1. Yes</span>
          </text>

          {/* Option 2: Yes, and don't ask again (only if rule can be inferred) */}
          {canSaveRule && (
            <text>
              <span fg={PRIMARY_COLOR}>{selected === 1 ? "› " : "  "}</span>
              <span fg={selected === 1 ? PRIMARY_COLOR : undefined}>
                2. Yes, and don't ask again for{" "}
              </span>
              <span
                fg={selected === 1 ? PRIMARY_COLOR : undefined}
                attributes={TextAttributes.BOLD}
              >
                {dontAskAgainPattern}
              </span>
            </text>
          )}

          {/* Option 3 (or 2 if no rule): Inline text input */}
          <box flexDirection="row">
            <text fg={PRIMARY_COLOR}>
              {selected === reasonOptionIndex ? "› " : "  "}
            </text>
            <text
              fg={selected === reasonOptionIndex ? PRIMARY_COLOR : undefined}
            >
              {canSaveRule ? "3" : "2"}.
            </text>
            {reason || selected === reasonOptionIndex ? (
              <>
                {reason && <text> </text>}
                <text
                  fg={
                    selected === reasonOptionIndex ? PRIMARY_COLOR : undefined
                  }
                >
                  {reason}
                </text>
                {selected === reasonOptionIndex && <text fg="gray">█</text>}
              </>
            ) : (
              <text fg="gray">
                {" "}
                Type here to tell Claude what to do differently
              </text>
            )}
          </box>
        </box>
      </box>

      {/* Footer hint */}
      <box marginTop={1}>
        <text fg="gray">
          {selected === reasonOptionIndex
            ? "Enter to submit, Esc to cancel"
            : "Esc to cancel"}
        </text>
      </box>
    </box>
  );
}
