import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  getTreeSitterClient,
  SyntaxStyle,
  type ThemeTokenStyle,
} from "@opentui/core";

const workerEnvVar = "OTUI_TREE_SITTER_WORKER_PATH";

if (!process.env[workerEnvVar]) {
  const execDir = dirname(process.execPath);
  const workerPath = join(execDir, "parser.worker.js");
  if (existsSync(workerPath)) {
    process.env[workerEnvVar] = workerPath;
  }
}

const CODE_THEME: ThemeTokenStyle[] = [
  { scope: ["default"], style: { foreground: "#d7d7d7" } },
  { scope: ["comment"], style: { foreground: "#6a9955", italic: true } },
  { scope: ["string"], style: { foreground: "#ce9178" } },
  { scope: ["string.special"], style: { foreground: "#d7ba7d" } },
  { scope: ["number"], style: { foreground: "#b5cea8" } },
  { scope: ["keyword"], style: { foreground: "#569cd6", bold: true } },
  { scope: ["operator"], style: { foreground: "#d4d4d4" } },
  { scope: ["function"], style: { foreground: "#dcdcaa" } },
  { scope: ["function.builtin"], style: { foreground: "#dcdcaa", bold: true } },
  { scope: ["type"], style: { foreground: "#4ec9b0" } },
  { scope: ["variable"], style: { foreground: "#9cdcfe" } },
  { scope: ["variable.builtin"], style: { foreground: "#4fc1ff" } },
  { scope: ["property"], style: { foreground: "#9cdcfe" } },
  { scope: ["constant"], style: { foreground: "#4fc1ff" } },
  { scope: ["constant.builtin"], style: { foreground: "#569cd6" } },
  { scope: ["punctuation"], style: { foreground: "#808080" } },
  { scope: ["punctuation.delimiter"], style: { foreground: "#808080" } },
  { scope: ["punctuation.bracket"], style: { foreground: "#808080" } },
  { scope: ["tag"], style: { foreground: "#569cd6" } },
  { scope: ["attribute"], style: { foreground: "#9cdcfe" } },
  { scope: ["markup.heading"], style: { foreground: "#c586c0", bold: true } },
  { scope: ["markup.italic"], style: { italic: true } },
  { scope: ["markup.bold"], style: { bold: true } },
  { scope: ["markup.raw"], style: { foreground: "#d7ba7d" } },
];

export const cliSyntaxStyle = SyntaxStyle.fromTheme(CODE_THEME);
export const cliTreeSitterClient = getTreeSitterClient();
