import { describe, expect, test } from "bun:test";
import { normalizeStreamdownHighlightResult } from "./streamdown-config";

describe("normalizeStreamdownHighlightResult", () => {
  test("normalizes dual-theme fg/bg and token styles", () => {
    const input: Parameters<typeof normalizeStreamdownHighlightResult>[0] = {
      bg: "#ffffff;--shiki-dark-bg:#0a0a0a",
      fg: "#171717;--shiki-dark:#ededed",
      rootStyle: "font-style:normal",
      themeName: "vercel-light vercel-dark",
      tokens: [
        [
          {
            bgColor: "#ffffff",
            color: "#bd2864",
            content: "const",
            htmlStyle: {
              "background-color": "#ffffff;--shiki-dark-bg:#0a0a0a",
              color: "#bd2864;--shiki-dark:#f75f8f",
            },
            offset: 0,
          },
        ],
      ],
    };

    const normalized = normalizeStreamdownHighlightResult(input);
    const [token] = normalized.tokens[0];

    expect(normalized.fg).toBe("#171717");
    expect(normalized.bg).toBe("#ffffff");
    expect(normalized.rootStyle).toContain("font-style:normal");
    expect(normalized.rootStyle).toContain("--shiki-dark:#ededed");
    expect(normalized.rootStyle).toContain("--shiki-dark-bg:#0a0a0a");
    expect(token.color).toBe("#bd2864");
    expect(token.bgColor).toBe("#ffffff");
    expect(token.htmlStyle?.color).toBeUndefined();
    expect(token.htmlStyle?.["background-color"]).toBeUndefined();
    expect(token.htmlStyle?.["--shiki-dark"]).toBe("#f75f8f");
    expect(token.htmlStyle?.["--shiki-dark-bg"]).toBe("#0a0a0a");
  });
});
