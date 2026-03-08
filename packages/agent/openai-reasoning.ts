import type { AssistantModelMessage, ModelMessage } from "ai";

const OPENAI_GPT_54_PREFIX = "openai/gpt-5.4";

type AssistantContentPart = Exclude<
  AssistantModelMessage["content"],
  string
>[number];

function shouldRemoveIncompleteOpenAIReasoningBlocks(modelId: string): boolean {
  return modelId.startsWith(OPENAI_GPT_54_PREFIX);
}

function hasEncryptedReasoningContent(part: AssistantContentPart): boolean {
  if (part.type !== "reasoning") {
    return false;
  }

  const encryptedContent =
    part.providerOptions?.openai?.reasoningEncryptedContent;

  return typeof encryptedContent === "string" && encryptedContent.length > 0;
}

function removeIncompleteReasoningFromAssistantContent(
  content: AssistantContentPart[],
): AssistantContentPart[] | null {
  let cleanedContent: AssistantContentPart[] | null = null;

  for (let index = 0; index < content.length; ) {
    const part = content[index];

    if (!part) {
      index += 1;
      continue;
    }

    if (part.type !== "reasoning") {
      cleanedContent?.push(part);
      index += 1;
      continue;
    }

    let runEnd = index + 1;
    while (content[runEnd]?.type === "reasoning") {
      runEnd += 1;
    }

    const lastReasoningPart = content[runEnd - 1];
    if (
      !lastReasoningPart ||
      !hasEncryptedReasoningContent(lastReasoningPart)
    ) {
      cleanedContent ??= content.slice(0, index);
      index = runEnd;
      continue;
    }

    if (cleanedContent) {
      for (
        let reasoningIndex = index;
        reasoningIndex < runEnd;
        reasoningIndex++
      ) {
        const reasoningPart = content[reasoningIndex];
        if (reasoningPart) {
          cleanedContent.push(reasoningPart);
        }
      }
    }

    index = runEnd;
  }

  if (cleanedContent === null) {
    return content;
  }

  if (cleanedContent.length === 0) {
    return null;
  }

  return cleanedContent;
}

export function removeIncompleteOpenAIReasoningBlocks(
  messages: ModelMessage[],
  modelId: string,
): ModelMessage[] {
  if (
    messages.length === 0 ||
    !shouldRemoveIncompleteOpenAIReasoningBlocks(modelId)
  ) {
    return messages;
  }

  let cleanedMessages: ModelMessage[] | null = null;

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];

    if (!message) {
      continue;
    }

    if (message.role !== "assistant" || !Array.isArray(message.content)) {
      cleanedMessages?.push(message);
      continue;
    }

    const cleanedContent = removeIncompleteReasoningFromAssistantContent(
      message.content,
    );

    if (cleanedContent === message.content) {
      cleanedMessages?.push(message);
      continue;
    }

    cleanedMessages ??= messages.slice(0, index);

    if (cleanedContent) {
      cleanedMessages.push({
        ...message,
        content: cleanedContent,
      });
    }
  }

  return cleanedMessages ?? messages;
}
