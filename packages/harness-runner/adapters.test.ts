import { describe, expect, test } from "bun:test";
import { createClaudeCode } from "@ai-sdk/harness-claude-code";

import {
  createHarnessAdapter,
  HARNESS_DEFINITIONS,
  HARNESS_INACTIVE_TOOLS,
  resolveHarnessModelId,
} from "./adapters.ts";
import { EXTERNAL_HARNESS_IDS } from "./ids.ts";

describe("HARNESS_DEFINITIONS", () => {
  test("stays in sync with the dependency-free id list", () => {
    expect(Object.keys(HARNESS_DEFINITIONS).sort()).toEqual(
      [...EXTERNAL_HARNESS_IDS].sort(),
    );
  });
});

describe("resolveHarnessModelId", () => {
  test("passes OpenAI models to Codex without the gateway provider prefix", () => {
    expect(resolveHarnessModelId("codex", "openai/gpt-5.4")).toBe("gpt-5.4");
  });

  test("uses the Codex default for models from another provider", () => {
    expect(
      resolveHarnessModelId("codex", "anthropic/claude-opus-4.6"),
    ).toBeUndefined();
  });

  test("passes Anthropic models to Claude Code without the gateway provider prefix", () => {
    expect(
      resolveHarnessModelId("claude-code", "anthropic/claude-opus-4.6"),
    ).toBe("claude-opus-4.6");
  });

  test("uses the Claude Code default for models from another provider", () => {
    expect(
      resolveHarnessModelId("claude-code", "openai/gpt-5.4"),
    ).toBeUndefined();
  });

  test("preserves the full AI Gateway model id for Pi", () => {
    expect(resolveHarnessModelId("pi", "anthropic/claude-opus-4.6")).toBe(
      "anthropic/claude-opus-4.6",
    );
  });
});

describe("createHarnessAdapter", () => {
  test("creates the Pi harness adapter", () => {
    expect(
      createHarnessAdapter("pi", "anthropic/claude-sonnet-4.6").harnessId,
    ).toBe("pi");
  });
});

describe("HARNESS_INACTIVE_TOOLS", () => {
  test("disables Claude Code's native AskUserQuestion tool", () => {
    expect(HARNESS_INACTIVE_TOOLS["claude-code"]).toContain("AskUserQuestion");
  });

  test("only names real Claude Code built-in tools", () => {
    const builtinToolNames = Object.keys(createClaudeCode().builtinTools);

    for (const toolName of HARNESS_INACTIVE_TOOLS["claude-code"] ?? []) {
      expect(builtinToolNames).toContain(toolName);
    }
  });

  test("claude code supports native built-in tool filtering", () => {
    expect(createClaudeCode().supportsBuiltinToolFiltering).toBe(true);
  });
});
