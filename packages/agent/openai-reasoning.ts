import type { AssistantModelMessage, LanguageModel, ModelMessage } from "ai";

const OPENAI_GPT_54_PREFIX = "openai/gpt-5.4";

type AssistantContentPart = Exclude<
  AssistantModelMessage["content"],
  string
>[number];

function shouldRemoveIncompleteOpenAIReasoningBlocks(modelId: string): boolean {
  return modelId.startsWith(OPENAI_GPT_54_PREFIX);
}

function getModelId(model: LanguageModel): string {
  return typeof model === "string" ? model : model.modelId;
}

interface OpenAIReasoningMetadata {
  hasOpenAIOptions: boolean;
  itemId: string | null;
  encryptedContent: string | null;
}

function getOpenAIReasoningMetadata(
  part: AssistantContentPart,
): OpenAIReasoningMetadata {
  if (part.type !== "reasoning") {
    return {
      hasOpenAIOptions: false,
      itemId: null,
      encryptedContent: null,
    };
  }

  const openaiOptions = part.providerOptions?.openai;
  if (!openaiOptions || typeof openaiOptions !== "object") {
    return {
      hasOpenAIOptions: false,
      itemId: null,
      encryptedContent: null,
    };
  }

  const itemId =
    typeof openaiOptions.itemId === "string" && openaiOptions.itemId.length > 0
      ? openaiOptions.itemId
      : null;
  const encryptedContent =
    typeof openaiOptions.reasoningEncryptedContent === "string" &&
    openaiOptions.reasoningEncryptedContent.trim().length > 0
      ? openaiOptions.reasoningEncryptedContent
      : null;

  return {
    hasOpenAIOptions: true,
    itemId,
    encryptedContent,
  };
}

function collectItemIdsWithEncryptedReasoningContent(
  messages: ModelMessage[],
): Set<string> {
  const itemIdsWithEncryptedContent = new Set<string>();

  for (const message of messages) {
    if (
      !message ||
      message.role !== "assistant" ||
      !Array.isArray(message.content)
    ) {
      continue;
    }

    for (const part of message.content) {
      if (!part) {
        continue;
      }

      const metadata = getOpenAIReasoningMetadata(part);
      if (metadata.itemId && metadata.encryptedContent) {
        itemIdsWithEncryptedContent.add(metadata.itemId);
      }
    }
  }

  return itemIdsWithEncryptedContent;
}

function removeIncompleteReasoningFromAssistantContent(
  content: AssistantContentPart[],
  itemIdsWithEncryptedContent: Set<string>,
): AssistantContentPart[] | null {
  let cleanedContent: AssistantContentPart[] | null = null;

  for (let index = 0; index < content.length; index++) {
    const part = content[index];

    if (!part) {
      continue;
    }

    const metadata = getOpenAIReasoningMetadata(part);
    const shouldStrip =
      metadata.encryptedContent === null &&
      ((metadata.itemId !== null &&
        !itemIdsWithEncryptedContent.has(metadata.itemId)) ||
        (metadata.itemId === null && metadata.hasOpenAIOptions));

    if (!shouldStrip) {
      cleanedContent?.push(part);
      continue;
    }

    cleanedContent ??= content.slice(0, index);
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

  const itemIdsWithEncryptedContent =
    collectItemIdsWithEncryptedReasoningContent(messages);

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
      itemIdsWithEncryptedContent,
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

export function preparePromptForOpenAIReasoning({
  model,
  messages,
  prompt,
}: {
  model: LanguageModel;
  messages?: ModelMessage[];
  prompt?: string | ModelMessage[];
}): {
  messages?: ModelMessage[];
  prompt?: string | ModelMessage[];
} {
  const modelId = getModelId(model);

  if (messages) {
    return {
      messages: removeIncompleteOpenAIReasoningBlocks(messages, modelId),
    };
  }

  if (Array.isArray(prompt)) {
    return {
      prompt: removeIncompleteOpenAIReasoningBlocks(prompt, modelId),
    };
  }

  return { prompt };
}
