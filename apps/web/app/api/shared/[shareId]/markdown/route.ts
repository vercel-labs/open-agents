import { isReasoningUIPart, isToolUIPart } from "ai";
import type { WebAgentUIMessage } from "@/app/types";
import { getChatById, getChatMessages } from "@/lib/db/sessions";
import {
  getSessionByIdCached,
  getShareByIdCached,
} from "@/lib/db/sessions-cache";
import { redactSharedEnvContent } from "../../../../shared/[shareId]/redact-shared-env-content";
import { formatElapsed } from "../../../../shared/[shareId]/shared-chat-status-utils";

interface RouteContext {
  params: Promise<{ shareId: string }>;
}

type MarkdownMessage = {
  message: WebAgentUIMessage;
  durationMs: number | null;
  toolCallCount: number;
  hasHiddenActivity: boolean;
};

function countToolCalls(message: WebAgentUIMessage): number {
  let count = 0;

  for (const part of message.parts) {
    if (isToolUIPart(part)) {
      count++;
    }
  }

  return count;
}

function hasHiddenActivity(message: WebAgentUIMessage): boolean {
  return message.parts.some(
    (part) => isToolUIPart(part) || isReasoningUIPart(part),
  );
}

function stringifyFrontmatterValue(value: number | string): string {
  return typeof value === "number" ? String(value) : JSON.stringify(value);
}

function buildFrontmatter(
  fields: Array<[key: string, value: number | string | null]>,
) {
  const lines: string[] = [];

  for (const [key, value] of fields) {
    if (value == null) {
      continue;
    }

    lines.push(`${key}: ${stringifyFrontmatterValue(value)}`);
  }

  return ["---", ...lines, "---"].join("\n");
}

function getMessageBody(message: WebAgentUIMessage): string {
  const blocks: string[] = [];

  for (const part of message.parts) {
    if (part.type === "text") {
      const text = part.text.trim();
      if (text.length > 0) {
        blocks.push(text);
      }
      continue;
    }

    if (part.type === "data-snippet") {
      blocks.push(
        `<snippet filename=${JSON.stringify(part.data.filename)}>` +
          `\n${part.data.content}\n</snippet>`,
      );
    }
  }

  return blocks.join("\n\n");
}

function buildMarkdown({
  sessionTitle,
  repo,
  branch,
  prUrl,
  prNumber,
  createdAt,
  messages,
}: {
  sessionTitle: string;
  repo: string | null;
  branch: string | null;
  prUrl: string | null;
  prNumber: number | null;
  createdAt: Date;
  messages: MarkdownMessage[];
}): string {
  const sections = [
    buildFrontmatter([
      ["session_name", sessionTitle],
      ["repo", repo],
      ["branch", branch],
      ["pr_url", prUrl],
      ["pr_number", prNumber],
      ["created_at", createdAt.toISOString()],
    ]),
    "",
  ];

  for (const [index, entry] of messages.entries()) {
    const previousMessage = index > 0 ? messages[index - 1]?.message : null;

    if (
      entry.message.role === "assistant" &&
      previousMessage?.role === "user" &&
      entry.hasHiddenActivity &&
      entry.durationMs != null
    ) {
      sections.push(
        `<!-- tool_activity: duration=${formatElapsed(entry.durationMs)} tool_calls=${entry.toolCallCount} -->`,
        "",
      );
    }

    sections.push(entry.message.role === "user" ? "## User" : "## Assistant");

    const body = getMessageBody(entry.message);
    if (body.length > 0) {
      sections.push(body);
    }

    sections.push("");
  }

  return `${sections.join("\n").trimEnd()}\n`;
}

function resolveContentType(request: Request): string {
  const accept = request.headers.get("accept")?.toLowerCase() ?? "";

  if (accept.includes("text/markdown")) {
    return "text/markdown; charset=utf-8";
  }

  return "text/plain; charset=utf-8";
}

export async function GET(request: Request, context: RouteContext) {
  const { shareId } = await context.params;
  const share = await getShareByIdCached(shareId);

  if (!share) {
    return new Response("Not found\n", {
      status: 404,
      headers: {
        "content-type": resolveContentType(request),
        vary: "Accept",
      },
    });
  }

  const sharedChat = await getChatById(share.chatId);
  if (!sharedChat) {
    return new Response("Not found\n", {
      status: 404,
      headers: {
        "content-type": resolveContentType(request),
        vary: "Accept",
      },
    });
  }

  const session = await getSessionByIdCached(sharedChat.sessionId);
  if (!session) {
    return new Response("Not found\n", {
      status: 404,
      headers: {
        "content-type": resolveContentType(request),
        vary: "Accept",
      },
    });
  }

  const repo =
    session.repoOwner && session.repoName
      ? `${session.repoOwner}/${session.repoName}`
      : null;
  const prUrl =
    repo && session.prNumber
      ? `https://github.com/${repo}/pull/${session.prNumber}`
      : null;

  const dbMessages = await getChatMessages(sharedChat.id);
  const messages: MarkdownMessage[] = dbMessages.map((messageRow, index) => {
    const message = redactSharedEnvContent(
      messageRow.parts as WebAgentUIMessage,
    );
    const previousMessage = index > 0 ? dbMessages[index - 1] : null;
    const durationMs =
      messageRow.role === "assistant" && previousMessage?.role === "user"
        ? messageRow.createdAt.getTime() - previousMessage.createdAt.getTime()
        : null;

    return {
      message,
      durationMs,
      toolCallCount: countToolCalls(message),
      hasHiddenActivity: hasHiddenActivity(message),
    };
  });

  return new Response(
    buildMarkdown({
      sessionTitle: session.title,
      repo,
      branch: session.branch,
      prUrl,
      prNumber: session.prNumber,
      createdAt: session.createdAt,
      messages,
    }),
    {
      headers: {
        "content-type": resolveContentType(request),
        vary: "Accept",
      },
    },
  );
}
