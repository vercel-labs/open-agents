import { describe, expect, test } from "bun:test";
import type { ToolRenderState } from "@open-harness/shared/lib/tool-state";
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
  test("shows the last stdout line instead of exit 0 in the header", () => {
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

    expect(html).toContain("899 packages installed [6.02s]");
    expect(html).not.toContain("exit 0");
  });

  test("shows the last stderr line instead of exit 1 in the header", () => {
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

    expect(html).toContain("Found 2 errors.");
    expect(html).not.toContain("exit 1");
  });
});
