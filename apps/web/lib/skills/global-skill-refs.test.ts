import { describe, expect, test } from "bun:test";
import {
  globalSkillRefsSchema,
  normalizeGlobalSkillRefs,
} from "./global-skill-refs";

describe("globalSkillRefsSchema", () => {
  test("dedupes refs while preserving the first entry", () => {
    const result = globalSkillRefsSchema.parse([
      { source: "vercel/ai", skillName: "ai-sdk" },
      { source: "Vercel/AI", skillName: "AI-SDK" },
      { source: "vercel/workflow", skillName: "workflow" },
    ]);

    expect(result).toEqual([
      { source: "vercel/ai", skillName: "ai-sdk" },
      { source: "vercel/workflow", skillName: "workflow" },
    ]);
  });

  test("rejects refs with invalid source or skill names", () => {
    const parsed = globalSkillRefsSchema.safeParse([
      { source: "vercel", skillName: "ai sdk" },
    ]);

    expect(parsed.success).toBe(false);
  });
});

describe("normalizeGlobalSkillRefs", () => {
  test("returns an empty array for invalid payloads", () => {
    expect(
      normalizeGlobalSkillRefs([{ source: "vercel", skillName: "ai-sdk" }]),
    ).toEqual([]);
  });
});
