import { describe, expect, test } from "bun:test";
import { gateway, type ModelMessage } from "ai";
import {
  preparePromptForOpenAIReasoning,
  removeIncompleteOpenAIReasoningBlocks,
} from "./openai-reasoning";

describe("removeIncompleteOpenAIReasoningBlocks", () => {
  test("removes assistant messages made only of incomplete GPT-5.4 reasoning blocks", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "Plan the fix." },
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "Inspecting the failure",
            providerOptions: {
              openai: {
                itemId: "rs_123",
              },
            },
          },
          {
            type: "reasoning",
            text: "Drafting the next step",
            providerOptions: {
              openai: {
                itemId: "rs_123",
              },
            },
          },
        ],
      },
      { role: "user", content: "Keep going" },
    ];

    expect(
      removeIncompleteOpenAIReasoningBlocks(messages, "openai/gpt-5.4-codex"),
    ).toEqual([
      { role: "user", content: "Plan the fix." },
      { role: "user", content: "Keep going" },
    ]);
  });

  test("keeps the original array when the final GPT-5.4 reasoning part has encrypted content", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "Plan the fix." },
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "Inspecting the failure",
            providerOptions: {
              openai: {
                itemId: "rs_123",
              },
            },
          },
          {
            type: "reasoning",
            text: "Drafting the next step",
            providerOptions: {
              openai: {
                itemId: "rs_123",
                reasoningEncryptedContent: "encrypted",
              },
            },
          },
          {
            type: "text",
            text: "Here is the plan.",
          },
        ],
      },
    ];

    expect(
      removeIncompleteOpenAIReasoningBlocks(messages, "openai/gpt-5.4-codex"),
    ).toBe(messages);
  });

  test("strips incomplete GPT-5.4 reasoning per itemId and preserves surrounding assistant content", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "Plan the fix." },
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Started planning.",
          },
          {
            type: "reasoning",
            text: "Incomplete first item",
            providerOptions: {
              openai: {
                itemId: "rs_incomplete",
              },
            },
          },
          {
            type: "reasoning",
            text: "Complete second item",
            providerOptions: {
              openai: {
                itemId: "rs_complete",
                reasoningEncryptedContent: "encrypted",
              },
            },
          },
          {
            type: "text",
            text: "Ready for the next step.",
          },
        ],
      },
    ];

    expect(
      removeIncompleteOpenAIReasoningBlocks(messages, "openai/gpt-5.4-codex"),
    ).toEqual([
      { role: "user", content: "Plan the fix." },
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Started planning.",
          },
          {
            type: "reasoning",
            text: "Complete second item",
            providerOptions: {
              openai: {
                itemId: "rs_complete",
                reasoningEncryptedContent: "encrypted",
              },
            },
          },
          {
            type: "text",
            text: "Ready for the next step.",
          },
        ],
      },
    ]);
  });

  test("skips cleanup for non-GPT-5.4 OpenAI models", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "Plan the fix." },
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "Inspecting the failure",
            providerOptions: {
              openai: {
                itemId: "rs_123",
              },
            },
          },
        ],
      },
    ];

    expect(
      removeIncompleteOpenAIReasoningBlocks(messages, "openai/gpt-5.3-codex"),
    ).toBe(messages);
  });

  test("sanitizes array prompts so prepareCall can reuse the same cleanup", () => {
    const prompt: ModelMessage[] = [
      { role: "user", content: "Plan the fix." },
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "Inspecting the failure",
            providerOptions: {
              openai: {
                itemId: "rs_123",
              },
            },
          },
        ],
      },
    ];

    expect(
      preparePromptForOpenAIReasoning({
        model: gateway("openai/gpt-5.4-codex"),
        prompt,
      }),
    ).toEqual({
      prompt: [{ role: "user", content: "Plan the fix." }],
    });
  });

  test("leaves string prompts untouched", () => {
    expect(
      preparePromptForOpenAIReasoning({
        model: gateway("openai/gpt-5.4-codex"),
        prompt: "Plan the fix.",
      }),
    ).toEqual({
      prompt: "Plan the fix.",
    });
  });
});
