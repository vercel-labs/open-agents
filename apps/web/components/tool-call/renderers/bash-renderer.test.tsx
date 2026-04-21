import { describe, expect, test } from "bun:test";
import type { ToolRenderState } from "@open-agents/shared/lib/tool-state";
import { renderToStaticMarkup } from "react-dom/server";
import type { ToolRendererProps } from "@/app/lib/render-tool";
import { BashRenderer } from "./bash-renderer";

const baseState: ToolRenderState = {
  running: false,
  interrupted: false,
  denied: false,
  approvalRequested: false,
  isActiveApproval: false,
};

describe("BashRenderer", () => {
  test("shows the command in the minimized header for successful runs", () => {
    const part = {
      type: "tool-bash",
      state: "output-available",
      input: {
        command: "bun install",
      },
      output: {
        success: true,
        exitCode: 0,
        stdout:
          "bun install v1.3.9 (cf6cdbbb)\n\n+ @biomejs/biome@2.3.11\n899 packages installed [6.02s]\n",
        stderr: "",
      },
    } as ToolRendererProps<"tool-bash">["part"];

    const html = renderToStaticMarkup(
      <BashRenderer part={part} state={baseState} />,
    );

    // Command is shown in the minimized summary
    expect(html).toContain("bun install");
    // Output is only in the expanded view, not the minimized meta
    expect(html).not.toContain("exit 0");
  });

  test("shows error state with exit code for failed commands", () => {
    const part = {
      type: "tool-bash",
      state: "output-available",
      input: {
        command: "bun run ci",
      },
      output: {
        success: false,
        exitCode: 1,
        stdout: "Checked 470 files in 228ms. No fixes applied.\n",
        stderr: "Found 2 errors.\n",
      },
    } as ToolRendererProps<"tool-bash">["part"];

    const html = renderToStaticMarkup(
      <BashRenderer part={part} state={baseState} />,
    );

    // Error state: shows tool name in red and exit code right-aligned
    expect(html).toContain(">Bash</span>");
    expect(html).toContain("text-red-500");
    expect(html).toContain("exit 1");
    // Error icon should be present
    expect(html).toContain("lucide-circle-x");
  });
});
