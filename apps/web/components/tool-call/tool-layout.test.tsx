import { describe, expect, test } from "bun:test";
import type { ToolRenderState } from "@open-harness/shared/lib/tool-state";
import { renderToStaticMarkup } from "react-dom/server";
import { ToolLayout } from "./tool-layout";

const baseState: ToolRenderState = {
  running: false,
  interrupted: false,
  denied: false,
  approvalRequested: false,
  isActiveApproval: false,
};

describe("ToolLayout interrupted state", () => {
  test("renders interrupted tool calls as a compact row with an inline badge", () => {
    const html = renderToStaticMarkup(
      <ToolLayout
        name="Bash"
        summary="agent-browser snapshot"
        state={{ ...baseState, interrupted: true }}
      />,
    );

    expect(html).toContain("Interrupted");
    expect(html).toContain("border-yellow-500/30 bg-yellow-500/10");
    expect(html).toContain("bg-transparent py-0.5");
    expect(html).not.toContain(
      '<div class="mt-2 pl-5 text-sm text-yellow-500">Interrupted</div>',
    );
  });
});

describe("ToolLayout error state", () => {
  test("renders failed tool calls as a compact row with inline error text but no badge", () => {
    const html = renderToStaticMarkup(
      <ToolLayout
        name="Read"
        summary="node_modules/drizzle-orm/migrator/index.js"
        state={{
          ...baseState,
          error: "Failed to read file: ENOENT: no such file or directory",
        }}
      />,
    );

    expect(html).toContain("text-red-500");
    expect(html).toContain(">Read</span>");
    expect(html).toContain(
      "Failed to read file: ENOENT: no such file or directory",
    );
    expect(html).toContain("bg-transparent py-0.5");
    expect(html).not.toContain("bg-card/60 p-3");
    expect(html).not.toContain("rounded-full border border-red-500/20");
    expect(html).not.toContain(
      '<div class="mt-2 pl-5 text-sm text-red-500">Error:',
    );
  });

  test("shows the full error inside expanded details", () => {
    const html = renderToStaticMarkup(
      <ToolLayout
        name="Read"
        summary="node_modules/drizzle-orm/migrator/index.js"
        state={{
          ...baseState,
          error:
            "Failed to read file: ENOENT: no such file or directory, stat '/vercel/sandbox/nope'",
        }}
        defaultExpanded
      />,
    );

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("text-red-600 dark:text-red-400");
    expect(html).toContain(
      "Failed to read file: ENOENT: no such file or directory, stat &#x27;/vercel/sandbox/nope&#x27;",
    );
  });
});
