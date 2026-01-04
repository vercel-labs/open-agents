import React, { useState, useEffect, type ReactNode } from "react";
import { Box, Text, useInput } from "ink";
import { useChat } from "@ai-sdk/react";
import { getToolName, isTextUIPart, isToolUIPart } from "ai";
import { useChatContext } from "../chat-context.js";
import type { TUIAgentUIToolPart } from "../types.js";

export type ToolApprovalInfo = {
  toolType: string;
  toolCommand: string;
  toolDescription?: string;
  dontAskAgainPattern?: string;
};

export function getToolApprovalInfo(
  part: TUIAgentUIToolPart,
  workingDirectory?: string,
): ToolApprovalInfo {
  const cwd = workingDirectory ?? process.cwd();

  switch (part.type) {
    case "tool-bash": {
      const command = String(part.input?.command ?? "");
      // Description may be provided by Claude as additional context
      const description = (part.input as { description?: string } | undefined)
        ?.description;
      // Extract first word of command for the pattern
      const firstWord = command.split(" ")[0] ?? "this command";
      return {
        toolType: "Bash command",
        toolCommand: command,
        toolDescription: description,
        dontAskAgainPattern: `${firstWord} commands in ${cwd}`,
      };
    }

    case "tool-write": {
      const filePath = String(part.input?.filePath ?? "");
      return {
        toolType: "Write file",
        toolCommand: filePath,
        toolDescription: "Create new file",
        dontAskAgainPattern: `writes in ${cwd}`,
      };
    }

    case "tool-edit": {
      const filePath = String(part.input?.filePath ?? "");
      return {
        toolType: "Edit file",
        toolCommand: filePath,
        toolDescription: "Modify existing file",
        dontAskAgainPattern: `edits in ${cwd}`,
      };
    }

    case "tool-task": {
      const desc = String(part.input?.task ?? "Spawning subagent");
      const subagentType = (part.input as { subagentType?: string })
        ?.subagentType;
      return {
        toolType:
          subagentType === "executor"
            ? "Executor task"
            : subagentType === "explorer"
              ? "Explorer task"
              : "Task",
        toolCommand: desc,
        toolDescription:
          subagentType === "executor"
            ? "This executor has full write access and can create, modify, and delete files."
            : undefined,
        dontAskAgainPattern: `${subagentType ?? "task"} operations`,
      };
    }

    default: {
      const toolName = getToolName(part);
      return {
        toolType: toolName.charAt(0).toUpperCase() + toolName.slice(1),
        toolCommand: JSON.stringify(part.input).slice(0, 60),
        dontAskAgainPattern: `${toolName} operations`,
      };
    }
  }
}

type DiffLine = {
  type: "context" | "addition" | "removal" | "separator";
  lineNumber?: number;
  content: string;
};

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function ToolSpinner() {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);

  return <Text color="yellow">{SPINNER_FRAMES[frame]} </Text>;
}

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

function ToolLayout({
  name,
  summary,
  output,
  error,
  running,
  denied,
  denialReason,
  approvalRequested,
  approvalId,
  isActiveApproval,
}: {
  name: string;
  summary: string;
  output?: ReactNode;
  error?: string;
  running: boolean;
  denied?: boolean;
  denialReason?: string;
  approvalRequested?: boolean;
  approvalId?: string;
  isActiveApproval?: boolean;
}) {
  const dotColor = denied
    ? "red"
    : approvalRequested
      ? "yellow"
      : running
        ? "yellow"
        : error
          ? "red"
          : "green";

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box>
        {running ? <ToolSpinner /> : <Text color={dotColor}>● </Text>}
        <Text
          bold
          color={
            denied ? "red" : running || approvalRequested ? "yellow" : "white"
          }
        >
          {name}
        </Text>
        <Text color="gray">(</Text>
        <Text color="cyan">{summary}</Text>
        <Text color="gray">)</Text>
      </Box>

      {/* Show Running/Waiting status for approval-requested tools */}
      {approvalRequested && (
        <Box paddingLeft={2}>
          <Text color="gray">└ </Text>
          <Text color="gray">{isActiveApproval ? "Running…" : "Waiting…"}</Text>
        </Box>
      )}

      {output && !approvalRequested && (
        <Box paddingLeft={2}>
          <Text color="gray">└ </Text>
          {output}
        </Box>
      )}

      {denied && (
        <Box paddingLeft={2}>
          <Text color="gray">└ </Text>
          <Text color="red">
            Denied{denialReason ? `: ${denialReason}` : ""}
          </Text>
        </Box>
      )}

      {error && (
        <Box paddingLeft={2}>
          <Text color="gray">└ </Text>
          <Text color="red">Error: {error.slice(0, 80)}</Text>
        </Box>
      )}
    </Box>
  );
}

function FileChangeLayout({
  action,
  filePath,
  additions,
  removals,
  lines,
  error,
  running,
  denied,
  denialReason,
  approvalRequested,
  approvalId,
  isActiveApproval,
}: {
  action: "Create" | "Update";
  filePath: string;
  additions: number;
  removals: number;
  lines: DiffLine[];
  error?: string;
  running: boolean;
  denied?: boolean;
  denialReason?: string;
  approvalRequested?: boolean;
  approvalId?: string;
  isActiveApproval?: boolean;
}) {
  const dotColor = denied
    ? "red"
    : approvalRequested
      ? "yellow"
      : running
        ? "yellow"
        : error
          ? "red"
          : "green";
  const maxWidth = 80;
  const showDiff = approvalRequested || (!running && !error);

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      {/* Header: ● Update(src/tui/lib/markdown.ts) */}
      <Box>
        {running ? <ToolSpinner /> : <Text color={dotColor}>● </Text>}
        <Text bold color="white">
          {action}
        </Text>
        <Text color="gray">(</Text>
        <Text color="cyan">{filePath}</Text>
        <Text color="gray">)</Text>
      </Box>

      {/* Show Running/Waiting status for approval-requested tools */}
      {approvalRequested && (
        <Box paddingLeft={2}>
          <Text color="gray">└ </Text>
          <Text color="gray">{isActiveApproval ? "Running…" : "Waiting…"}</Text>
        </Box>
      )}

      {/* Subheader: └ Updated src/file.ts with X additions and Y removals */}
      {showDiff && !approvalRequested && !denied && (
        <Box paddingLeft={2}>
          <Text color="gray">└ </Text>
          <Text>{action === "Create" ? "Created" : "Updated"} </Text>
          <Text bold>{filePath}</Text>
          <Text> with </Text>
          <Text color="green">
            {additions} addition{additions !== 1 ? "s" : ""}
          </Text>
          <Text> and </Text>
          <Text color="red">
            {removals} removal{removals !== 1 ? "s" : ""}
          </Text>
        </Box>
      )}

      {/* Diff lines */}
      {showDiff && !approvalRequested && !denied && lines.length > 0 && (
        <Box flexDirection="column" paddingLeft={4}>
          {lines.map((line, i) => (
            <Box key={i}>
              {line.type === "separator" ? (
                <Text color="gray">{line.content}</Text>
              ) : (
                <>
                  {/* Line number */}
                  <Text color="gray">
                    {line.lineNumber !== undefined
                      ? String(line.lineNumber).padStart(4, " ")
                      : "    "}{" "}
                  </Text>

                  {/* +/- indicator and content */}
                  {line.type === "addition" ? (
                    <>
                      <Text backgroundColor="#234823">+ </Text>
                      <Text backgroundColor="#234823">
                        {line.content.slice(0, maxWidth)}
                      </Text>
                    </>
                  ) : line.type === "removal" ? (
                    <>
                      <Text backgroundColor="#5c2626">- </Text>
                      <Text backgroundColor="#5c2626">
                        {line.content.slice(0, maxWidth)}
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text color="gray"> </Text>
                      <Text>{line.content.slice(0, maxWidth)}</Text>
                    </>
                  )}
                </>
              )}
            </Box>
          ))}
        </Box>
      )}

      {denied && (
        <Box paddingLeft={2}>
          <Text color="gray">└ </Text>
          <Text color="red">
            Denied{denialReason ? `: ${denialReason}` : ""}
          </Text>
        </Box>
      )}

      {error && (
        <Box paddingLeft={2}>
          <Text color="gray">└ </Text>
          <Text color="red">Error: {error.slice(0, 80)}</Text>
        </Box>
      )}
    </Box>
  );
}

function createWriteDiffLines(
  content: string,
  maxLines: number = 10,
): DiffLine[] {
  const contentLines = content.split("\n");
  const result: DiffLine[] = [];

  if (contentLines.length <= maxLines) {
    contentLines.forEach((line, i) => {
      result.push({ type: "addition", lineNumber: i + 1, content: line });
    });
  } else {
    // Show first few and last few lines with separator
    const showStart = Math.floor(maxLines / 2);
    const showEnd = maxLines - showStart;

    for (let i = 0; i < showStart; i++) {
      const line = contentLines[i];
      if (line !== undefined) {
        result.push({ type: "addition", lineNumber: i + 1, content: line });
      }
    }

    result.push({ type: "separator", content: "..." });

    for (let i = contentLines.length - showEnd; i < contentLines.length; i++) {
      const line = contentLines[i];
      if (line !== undefined) {
        result.push({ type: "addition", lineNumber: i + 1, content: line });
      }
    }
  }

  return result;
}

function createEditDiffLines(
  oldString: string,
  newString: string,
  contextLines: number = 2,
  maxLines: number = 15,
): { lines: DiffLine[]; additions: number; removals: number } {
  const oldLines = oldString.split("\n");
  const newLines = newString.split("\n");
  const result: DiffLine[] = [];

  // Simple diff: show context, removals, then additions
  // For now, show the old lines as removals and new lines as additions with context

  // Count additions and removals
  const removals = oldLines.length;
  const additions = newLines.length;

  // Build diff with context
  const allLines: DiffLine[] = [];

  // Add context before (if we had it - for now just show the change)
  oldLines.forEach((line, i) => {
    allLines.push({ type: "removal", lineNumber: i + 1, content: line });
  });

  newLines.forEach((line, i) => {
    allLines.push({ type: "addition", lineNumber: i + 1, content: line });
  });

  // Limit total lines
  if (allLines.length <= maxLines) {
    return { lines: allLines, additions, removals };
  }

  // Show first portion and last portion with separator
  const half = Math.floor(maxLines / 2);
  for (let i = 0; i < half; i++) {
    const line = allLines[i];
    if (line) result.push(line);
  }
  result.push({ type: "separator", content: "..." });
  for (let i = allLines.length - half; i < allLines.length; i++) {
    const line = allLines[i];
    if (line) result.push(line);
  }

  return { lines: result, additions, removals };
}

// Simplified tool call renderer for subagent tool parts
// Uses a looser type since these come from a different agent's tool set
export function SubagentToolCall({
  part,
}: {
  part: Parameters<typeof getToolName>[0];
}) {
  const toolName = getToolName(part);
  const isRunning = part.state === "input-streaming" || part.state === "input-available";
  const hasError = part.state === "output-error";

  // Extract a summary based on common tool input patterns
  const input = part.input as Record<string, unknown> | undefined;
  let summary = "";
  if (input?.filePath) {
    summary = String(input.filePath);
  } else if (input?.pattern) {
    summary = `"${input.pattern}"`;
  } else if (input?.command) {
    summary = String(input.command);
  } else if (input) {
    summary = JSON.stringify(input).slice(0, 40);
  }

  const dotColor = isRunning ? "yellow" : hasError ? "red" : "green";
  const displayName = toolName.charAt(0).toUpperCase() + toolName.slice(1);

  return (
    <Box paddingLeft={1}>
      <Text color="gray">│ </Text>
      <Box>
        {isRunning ? <ToolSpinner /> : <Text color={dotColor}>● </Text>}
        <Text bold color={isRunning ? "yellow" : "white"}>
          {displayName}
        </Text>
        {summary && (
          <>
            <Text color="gray">(</Text>
            <Text color="cyan">{summary}</Text>
            <Text color="gray">)</Text>
          </>
        )}
        {hasError && <Text color="red"> - error</Text>}
      </Box>
    </Box>
  );
}

export function ToolCall({
  part,
  activeApprovalId,
  isExpanded = false,
}: {
  part: TUIAgentUIToolPart;
  activeApprovalId: string | null;
  isExpanded?: boolean;
}) {
  const running =
    part.state === "input-streaming" || part.state === "input-available";
  const approval = (part as { approval?: { id?: string; approved?: boolean; reason?: string } }).approval;
  // Check for denial both via state and via approval object (for intermediate states)
  const denied = part.state === "output-denied" || approval?.approved === false;
  const denialReason = denied ? approval?.reason : undefined;
  const approvalRequested = part.state === "approval-requested" && !denied;
  const error = part.state === "output-error" ? part.errorText : undefined;
  const approvalId = approvalRequested ? approval?.id : undefined;
  // Only show interactive approval buttons for the first pending approval
  const isActiveApproval = approvalId != null && approvalId === activeApprovalId;

  switch (part.type) {
    case "tool-read": {
      const filePath = part.input?.filePath ?? "...";
      const lines =
        part.state === "output-available" ? part.output?.totalLines : undefined;
      return (
        <ToolLayout
          name="Read"
          summary={lines ? `${filePath} (${lines} lines)` : filePath}
          output={lines && <Text color="white">Read {lines} lines</Text>}
          error={error}
          running={running}
        />
      );
    }

    case "tool-write": {
      const filePath = part.input?.filePath ?? "...";
      const content = part.input?.content ?? "";
      const lines = createWriteDiffLines(content);
      const additions = content ? content.split("\n").length : 0;

      // Check for tool execution failure (success: false in output)
      const outputError =
        part.state === "output-available" && part.output?.success === false
          ? (part.output?.error ?? "Write failed")
          : undefined;

      return (
        <FileChangeLayout
          action="Create"
          filePath={filePath}
          additions={additions}
          removals={0}
          lines={running || denied || outputError ? [] : lines}
          error={error ?? outputError}
          running={running}
          denied={denied}
          denialReason={denialReason}
          approvalRequested={approvalRequested}
          approvalId={approvalId}
          isActiveApproval={isActiveApproval}
        />
      );
    }

    case "tool-edit": {
      const filePath = part.input?.filePath ?? "...";
      const oldString = part.input?.oldString ?? "";
      const newString = part.input?.newString ?? "";
      const { lines, additions, removals } = createEditDiffLines(
        oldString,
        newString,
      );

      // Check for tool execution failure (success: false in output)
      const outputError =
        part.state === "output-available" && part.output?.success === false
          ? (part.output?.error ?? "Edit failed")
          : undefined;

      return (
        <FileChangeLayout
          action="Update"
          filePath={filePath}
          additions={additions}
          removals={removals}
          lines={running || denied || outputError ? [] : lines}
          error={error ?? outputError}
          running={running}
          denied={denied}
          denialReason={denialReason}
          approvalRequested={approvalRequested}
          approvalId={approvalId}
          isActiveApproval={isActiveApproval}
        />
      );
    }

    case "tool-glob": {
      const pattern = part.input?.pattern ?? "...";
      const files =
        part.state === "output-available" ? part.output?.files : undefined;
      return (
        <ToolLayout
          name="Glob"
          summary={`"${pattern}"`}
          output={
            files && <Text color="white">Found {files.length} files</Text>
          }
          error={error}
          running={running}
        />
      );
    }

    case "tool-grep": {
      const pattern = part.input?.pattern ?? "...";
      const matches =
        part.state === "output-available" ? part.output?.matches : undefined;
      return (
        <ToolLayout
          name="Grep"
          summary={`"${pattern}"`}
          output={
            matches && <Text color="white">Found {matches.length} matches</Text>
          }
          error={error}
          running={running}
        />
      );
    }

    case "tool-bash": {
      const command = String(part.input?.command ?? "");
      const exitCode =
        part.state === "output-available" ? part.output?.exitCode : undefined;
      return (
        <ToolLayout
          name="Bash"
          summary={command || "..."}
          output={
            exitCode !== undefined && (
              <Text color="white">
                {exitCode === 0 ? "Command succeeded" : `Exit code ${exitCode}`}
              </Text>
            )
          }
          error={error}
          running={running}
          denied={denied}
          denialReason={denialReason}
          approvalRequested={approvalRequested}
          approvalId={approvalId}
          isActiveApproval={isActiveApproval}
        />
      );
    }

    case "tool-todo_write": {
      const todos = part.input?.todos as Array<{ id: string; content: string; status: string }> | undefined;
      const todoCount = todos?.length ?? 0;
      const completedCount = todos?.filter(t => t.status === "completed").length ?? 0;
      const inProgressCount = todos?.filter(t => t.status === "in_progress").length ?? 0;
      
      const getTodoIcon = (status: string) => {
        switch (status) {
          case "completed": return "☒";
          case "in_progress": return "◎";
          default: return "☐";
        }
      };
      
      const getTodoColor = (status: string) => {
        switch (status) {
          case "completed": return "gray";
          case "in_progress": return "yellow";
          default: return "white";
        }
      };
      
      return (
        <Box flexDirection="column">
          <ToolLayout
            name="TodoWrite"
            summary={`${todoCount} tasks (${completedCount} done, ${inProgressCount} in progress)`}
            output={
              part.state === "output-available" && (
                <Text color="white">Tasks updated</Text>
              )
            }
            error={error}
            running={running}
          />
          {isExpanded && todos && todos.length > 0 && (
            <Box flexDirection="column" paddingLeft={3}>
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
          )}
        </Box>
      );
    }

    case "tool-task": {
      const desc = part.input?.task ?? "Spawning subagent";
      const subagentType = (part.input as { subagentType?: string })?.subagentType;
      const taskApprovalRequested = part.state === "approval-requested";
      const taskApprovalId = taskApprovalRequested
        ? (part as { approval?: { id: string } }).approval?.id
        : undefined;
      const isTaskActiveApproval = taskApprovalId != null && taskApprovalId === activeApprovalId;
      const taskDenied = part.state === "output-denied";
      const taskDenialReason = taskDenied
        ? (part as { approval?: { reason?: string } }).approval?.reason
        : undefined;

      // The output is a UIMessage with parts (text, tool-invocation, etc.)
      // Preliminary results have preliminary: true, final result has preliminary: false/undefined
      const hasOutput = part.state === "output-available";
      const isPreliminary = hasOutput && part.preliminary === true;
      const message = hasOutput ? part.output : undefined;

      // Get all parts in order, filter to text and tool parts
      const messageParts = message?.parts ?? [];
      const relevantParts = messageParts.filter(
        (p) => isToolUIPart(p) || isTextUIPart(p)
      );
      const toolParts = messageParts.filter(isToolUIPart);

      // Show only the last few parts to avoid too much output
      const maxVisible = 4;
      const hiddenCount = Math.max(0, relevantParts.length - maxVisible);
      const visibleParts = relevantParts.slice(-maxVisible);

      const isComplete = hasOutput && !isPreliminary;
      const isStreaming = hasOutput && isPreliminary;

      const dotColor = taskDenied 
        ? "red" 
        : taskApprovalRequested 
          ? "yellow"
          : isStreaming 
            ? "yellow" 
            : isComplete 
              ? "green" 
              : "yellow";
      
      // Format subagent type for display
      const subagentLabel = subagentType === "explorer" 
        ? "Explorer" 
        : subagentType === "executor" 
          ? "Executor" 
          : "Task";

      return (
        <Box flexDirection="column" marginTop={1} marginBottom={1}>
          {/* Header */}
          <Box>
            {running || isStreaming ? <ToolSpinner /> : <Text color={dotColor}>● </Text>}
            <Text bold color={taskDenied ? "red" : running || isStreaming || taskApprovalRequested ? "yellow" : "white"}>
              {subagentLabel}
            </Text>
            <Text color="gray">(</Text>
            <Text color="cyan">{desc}</Text>
            <Text color="gray">)</Text>
          </Box>

          {/* Executor approval warning */}
          {taskApprovalRequested && subagentType === "executor" && (
            <Box paddingLeft={2} marginTop={1}>
              <Text color="yellow">
                This executor has full write access and can create, modify, and delete files.
              </Text>
            </Box>
          )}

          {/* Denied message */}
          {taskDenied && (
            <Box paddingLeft={2}>
              <Text color="gray">└ </Text>
              <Text color="red">
                Denied{taskDenialReason ? `: ${taskDenialReason}` : ""}
              </Text>
            </Box>
          )}

          {/* Nested parts from subagent (text and tools in order) */}
          {hasOutput && visibleParts.length > 0 && (
            <Box flexDirection="column" paddingLeft={2} marginTop={1}>
              {hiddenCount > 0 && (
                <Box marginBottom={1}>
                  <Text color="gray">
                    ... {hiddenCount} more above
                  </Text>
                </Box>
              )}
              {visibleParts.map((p, i) => {
                if (isToolUIPart(p)) {
                  return <SubagentToolCall key={p.toolCallId} part={p} />;
                }
                if (isTextUIPart(p)) {
                  // Show truncated text, dimmed
                  const text = p.text.trim();
                  if (!text) return null;
                  const truncated = text.length > 80 ? text.slice(0, 80) + "..." : text;
                  return (
                    <Box key={`text-${i}`} paddingLeft={1}>
                      <Text color="gray">│ </Text>
                      <Text color="gray" dimColor>{truncated}</Text>
                    </Box>
                  );
                }
                return null;
              })}
            </Box>
          )}

          {/* Completion status */}
          {isComplete && (
            <Box paddingLeft={2}>
              <Text color="gray">└ </Text>
              <Text color="white">Complete ({toolParts.length} tool calls)</Text>
            </Box>
          )}

          {error && (
            <Box paddingLeft={2}>
              <Text color="gray">└ </Text>
              <Text color="red">Error: {error.slice(0, 80)}</Text>
            </Box>
          )}
        </Box>
      );
    }

    default: {
      const toolName = getToolName(part);

      const name = toolName.charAt(0).toUpperCase() + toolName.slice(1);
      return (
        <ToolLayout
          name={name}
          summary={JSON.stringify(part.input).slice(0, 40)}
          output={
            part.state === "output-available" && <Text color="white">Done</Text>
          }
          error={error}
          running={running}
        />
      );
    }
  }
}
