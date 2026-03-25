import { describe, expect, test } from "bun:test";
import {
  assistantFileLinkPrompt,
  buildWorkspaceFileHref,
  parseWorkspaceFileHref,
  WORKSPACE_FILE_HREF_PREFIX,
} from "./assistant-file-links";

describe("assistant file links", () => {
  test("builds and parses the reserved workspace file href", () => {
    const href = buildWorkspaceFileHref(
      "apps/web/app/sessions/[sessionId]/page.tsx",
    );

    expect(href).toBe(
      "#workspace-file=apps/web/app/sessions/[sessionId]/page.tsx",
    );
    expect(parseWorkspaceFileHref(href)).toBe(
      "apps/web/app/sessions/[sessionId]/page.tsx",
    );
  });

  test("parses encoded and windows-style paths", () => {
    expect(
      parseWorkspaceFileHref(
        `${WORKSPACE_FILE_HREF_PREFIX}apps%5Cweb%5Clib%5Ctest%20file.ts`,
      ),
    ).toBe("apps/web/lib/test file.ts");
  });

  test("ignores non-workspace hrefs", () => {
    expect(parseWorkspaceFileHref("https://example.com")).toBeNull();
    expect(parseWorkspaceFileHref("#workspace-file=")).toBeNull();
    expect(parseWorkspaceFileHref(undefined)).toBeNull();
  });

  test("documents the exact markdown link format for the agent", () => {
    expect(assistantFileLinkPrompt).toContain(
      "[path/to/file.ts](#workspace-file=path/to/file.ts)",
    );
    expect(assistantFileLinkPrompt).toContain("Whole-file links only for now");
  });
});
