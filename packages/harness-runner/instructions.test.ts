import { describe, expect, test } from "bun:test";
import { EXTERNAL_HARNESS_IDS } from "./ids.ts";
import { HARNESS_INSTRUCTIONS } from "./instructions.ts";

describe("HARNESS_INSTRUCTIONS", () => {
  test.each([...EXTERNAL_HARNESS_IDS])(
    "instructs %s to use ask_user_question instead of prose fallback",
    (harnessId) => {
      expect(HARNESS_INSTRUCTIONS[harnessId]).toContain(
        "The ask_user_question tool is available",
      );
      expect(HARNESS_INSTRUCTIONS[harnessId]).toContain(
        "your first assistant action must be an ask_user_question tool call",
      );
    },
  );

  test.each([...EXTERNAL_HARNESS_IDS])(
    "instructs %s to use todo_write for visible task tracking",
    (harnessId) => {
      expect(HARNESS_INSTRUCTIONS[harnessId]).toContain(
        "The todo_write tool is available",
      );
      expect(HARNESS_INSTRUCTIONS[harnessId]).toContain(
        "Only one task should be in_progress at a time",
      );
    },
  );

  test("keeps the Codex MCP relay fallback guidance", () => {
    expect(HARNESS_INSTRUCTIONS.codex).toContain(
      "Do not say that the structured question tool is unavailable",
    );
  });

  test("steers Claude Code away from its built-in TodoWrite tool", () => {
    expect(HARNESS_INSTRUCTIONS["claude-code"]).toContain(
      "instead of your built-in TodoWrite tool",
    );
  });

  test("names each harness in its own instructions", () => {
    expect(HARNESS_INSTRUCTIONS.codex).toContain("this Codex harness session");
    expect(HARNESS_INSTRUCTIONS["claude-code"]).toContain(
      "this Claude Code harness session",
    );
    expect(HARNESS_INSTRUCTIONS.pi).toContain("this Pi harness session");
  });
});
