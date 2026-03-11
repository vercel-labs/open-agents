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
