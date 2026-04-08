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
  test("renders interrupted tool calls with yellow header styling and OctagonPause icon", () => {
    const html = renderToStaticMarkup(
      <ToolLayout
        name="Bash"
        summary="agent-browser snapshot"
        state={{ ...baseState, interrupted: true }}
      />,
    );

    // Yellow styling on name and summary (like error uses red)
    expect(html).toContain("text-yellow-500");
    expect(html).toContain("text-yellow-400/80");
    expect(html).toContain("bg-transparent");
    // OctagonPause icon should be present
    expect(html).toContain("lucide-octagon-pause");
    // Should NOT have the old pill badge
    expect(html).not.toContain("border-yellow-500/30 bg-yellow-500/10");
    expect(html).not.toContain("py-0.5");
  });

  test("shows yellow interrupted box when expanded", () => {
    const html = renderToStaticMarkup(
      <ToolLayout
        name="Bash"
        summary="agent-browser snapshot"
        state={{ ...baseState, interrupted: true }}
        defaultExpanded
      />,
    );

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("border-yellow-500/20 bg-yellow-500/5");
    expect(html).toContain("interrupted");
  });
});

describe("ToolLayout error state", () => {
  test("renders failed tool calls with error icon and tool name in red in minimized view", () => {
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
    // Error state keeps the tool name (in red) instead of replacing with "Error"
    expect(html).toContain(">Read</span>");
    expect(html).toContain("node_modules/drizzle-orm/migrator/index.js");
    expect(html).toContain("text-red-400/80");
    expect(html).toContain("bg-transparent");
    // Error icon (CircleX) should be present
    expect(html).toContain("lucide-circle-x");
  });

  test("shows error header and expanded details when defaultExpanded", () => {
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
    // Error header keeps tool name in red
    expect(html).toContain(">Read</span>");
    expect(html).toContain(
      "Failed to read file: ENOENT: no such file or directory, stat &#x27;/vercel/sandbox/nope&#x27;",
    );
    // Expanded error output
    expect(html).toContain("border-red-500/20 bg-red-500/5");
    expect(html).toContain("text-red-400");
  });

  test("renders expanded details inline without muted background", () => {
    const html = renderToStaticMarkup(
      <ToolLayout
        name="Grep"
        summary='"Preview"'
        state={baseState}
        expandedContent={<div>Pattern details</div>}
        defaultExpanded
      />,
    );

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("bg-transparent");
    expect(html).not.toContain("bg-muted/35");
    // Uses +/- hover pattern instead of chevron
    expect(html).toContain("lucide-minus");
    expect(html).toContain(
      "transition-[grid-template-rows,opacity,margin-top] motion-reduce:transition-none",
    );
    expect(html).toContain(
      "mt-1.5 grid-rows-[1fr] opacity-100 duration-200 ease-out",
    );
    expect(html).not.toContain("bg-card/60 p-3");
    expect(html).not.toContain("border-t border-border pt-3");
  });

  test("keeps collapsed details mounted so opening can animate", () => {
    const html = renderToStaticMarkup(
      <ToolLayout
        name="Grep"
        summary='"Preview"'
        state={baseState}
        expandedContent={<div>Pattern details</div>}
      />,
    );

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(
      "grid-rows-[0fr] opacity-0 pointer-events-none duration-150 ease-out",
    );
    expect(html).toContain(
      "transition-[grid-template-rows,opacity,margin-top] motion-reduce:transition-none",
    );
    expect(html).not.toContain("Pattern details");
    // Uses +/- hover pattern instead of chevron
    expect(html).not.toContain("rotate-90");
  });
});
