import { describe, expect, test } from "bun:test";
import { createClaudeCode } from "@ai-sdk/harness-claude-code";

import { HARNESS_INACTIVE_TOOLS } from "./adapters.ts";

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
