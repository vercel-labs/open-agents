import { isToolUIPart } from "ai";
import type { WebAgentUIMessage } from "@/app/types";

function isTerminalClientToolPart(
  part: WebAgentUIMessage["parts"][number],
): boolean {
  return (
    isToolUIPart(part) &&
    !part.providerExecuted &&
    (part.state === "output-available" ||
      part.state === "output-error" ||
      part.state === "approval-responded")
  );
}

/**
 * Continue after client-side tool input is supplied.
 *
 * Harness streams now provide step boundaries. The trailing-tool fallback
 * keeps older persisted question messages resumable without allowing a
 * completed tool from an earlier turn to trigger requests forever.
 */
export function shouldAutoSubmitChat({
  messages,
}: {
  messages: WebAgentUIMessage[];
}): boolean {
  const lastMessage = messages.at(-1);
  if (!lastMessage || lastMessage.role !== "assistant") {
    return false;
  }

  const lastStepStartIndex = lastMessage.parts.findLastIndex(
    (part) => part.type === "step-start",
  );

  if (lastStepStartIndex === -1) {
    const trailingPart = lastMessage.parts.at(-1);
    return trailingPart !== undefined && isTerminalClientToolPart(trailingPart);
  }

  const clientToolParts = lastMessage.parts
    .slice(lastStepStartIndex + 1)
    .filter(isToolUIPart)
    .filter((part) => !part.providerExecuted);

  return (
    clientToolParts.length > 0 &&
    clientToolParts.every(isTerminalClientToolPart)
  );
}
