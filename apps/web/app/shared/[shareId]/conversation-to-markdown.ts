import { isReasoningUIPart, isToolUIPart } from "ai";
import { getToolName } from "@/app/lib/render-tool";
import type { WebAgentUIMessage, WebAgentUIMessagePart } from "@/app/types";
import type { MessageWithTiming } from "./shared-chat-content";

type SerializeInput = {
  title: string | null;
  shareId: string;
  sharedAt: Date;
  chats: ReadonlyArray<{
    title: string | null;
    messages: ReadonlyArray<MessageWithTiming>;
  }>;
};

function renderRoleHeading(role: WebAgentUIMessage["role"]): string {
  switch (role) {
    case "user":
      return "## User";
    case "assistant":
      return "## Agent";
    case "system":
      return "## System";
    default:
      return `## ${String(role)}`;
  }
}

function renderTextPart(part: WebAgentUIMessagePart): string | null {
  if (part.type === "text" && "text" in part && typeof part.text === "string") {
    const trimmed = part.text.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function renderToolPart(part: WebAgentUIMessagePart): string {
  if (!isToolUIPart(part)) {
    return "";
  }
  const name = getToolName(part);
  const state = "state" in part ? String(part.state ?? "") : "";
  const header = state ? `Tool call: ${name} (${state})` : `Tool call: ${name}`;
  const details: string[] = [];
  if ("input" in part && part.input !== undefined) {
    details.push(`input:\n${JSON.stringify(part.input, null, 2)}`);
  }
  if ("output" in part && part.output !== undefined) {
    details.push(`output:\n${JSON.stringify(part.output, null, 2)}`);
  }
  const body = details.join("\n\n");
  if (body.length === 0) {
    return `### ${header}\n`;
  }
  return `### ${header}\n\n\`\`\`json\n${body}\n\`\`\`\n`;
}

function renderReasoningPart(part: WebAgentUIMessagePart): string | null {
  if (!isReasoningUIPart(part)) {
    return null;
  }
  const text =
    "text" in part && typeof part.text === "string" ? part.text.trim() : "";
  if (text.length === 0) {
    return null;
  }
  return `<details><summary>Agent reasoning</summary>\n\n${text}\n\n</details>`;
}

function renderOtherPart(part: WebAgentUIMessagePart): string | null {
  if (part.type.startsWith("data-")) {
    const label = part.type.replace(/^data-/, "");
    return `[attachment: ${label}]`;
  }
  if (part.type === "file") {
    return "[attachment: file]";
  }
  if (part.type === "source-url" || part.type === "source-document") {
    return `[attachment: ${part.type}]`;
  }
  return null;
}

function renderMessage(item: MessageWithTiming): string {
  const { message } = item;
  const lines: string[] = [renderRoleHeading(message.role)];
  const body: string[] = [];

  for (const part of message.parts) {
    const text = renderTextPart(part);
    if (text !== null) {
      body.push(text);
      continue;
    }
    const reasoning = renderReasoningPart(part);
    if (reasoning !== null) {
      body.push(reasoning);
      continue;
    }
    if (isToolUIPart(part)) {
      body.push(renderToolPart(part));
      continue;
    }
    const other = renderOtherPart(part);
    if (other !== null) {
      body.push(other);
    }
  }

  if (body.length === 0) {
    return "";
  }
  lines.push("", body.join("\n\n"));
  return lines.join("\n");
}

export function conversationToMarkdown(input: SerializeInput): string {
  const headingTitle =
    input.title && input.title.trim().length > 0
      ? input.title.trim()
      : "Shared Chat";
  const header = [
    `# ${headingTitle}`,
    "",
    `Shared from Open Agents - ${input.sharedAt.toISOString()}`,
    `Share ID: ${input.shareId}`,
  ];

  const sections: string[] = [header.join("\n")];

  for (const chat of input.chats) {
    if (input.chats.length > 1) {
      const chatHeading =
        chat.title && chat.title.trim().length > 0 ? chat.title.trim() : "Chat";
      sections.push(`# ${chatHeading}`);
    }
    for (const item of chat.messages) {
      const rendered = renderMessage(item);
      if (rendered.length > 0) {
        sections.push(rendered);
      }
    }
  }

  return `${sections.join("\n\n")}\n`;
}
