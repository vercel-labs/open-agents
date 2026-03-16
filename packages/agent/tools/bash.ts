import { tool } from "ai";
import { z } from "zod";
import * as path from "path";
import { getSandbox } from "./utils";

const TIMEOUT_MS = 120_000;

const bashInputSchema = z.object({
  command: z.string().describe("The bash command to execute"),
  cwd: z
    .string()
    .optional()
    .describe(
      "Workspace-relative working directory for the command (e.g., apps/web)",
    ),
  detached: z
    .boolean()
    .optional()
    .describe(
      "Use this whenever you want to run a persistent server in the background (e.g., npm run dev, next dev). The command starts and returns immediately without waiting for it to finish.",
    ),
});

type BashInput = z.infer<typeof bashInputSchema>;
type ApprovalFn = (args: BashInput) => boolean | Promise<boolean>;

interface ToolOptions {
  needsApproval?: boolean | ApprovalFn;
}

// Commands that should require approval
const DANGEROUS_COMMAND_PATTERNS = [/\brm\s+-rf\b/];

/**
 * Check if a command should require approval.
 * Returns true only for dangerous patterns.
 */
export function commandNeedsApproval(command: string): boolean {
  const trimmedCommand = command.trim();

  for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
    if (pattern.test(trimmedCommand)) {
      return true;
    }
  }

  return false;
}

export const bashTool = (options?: ToolOptions) =>
  tool({
    needsApproval: async (args) => {
      if (commandNeedsApproval(args.command)) {
        if (typeof options?.needsApproval === "function") {
          return options.needsApproval(args);
        }
        return options?.needsApproval ?? true;
      }

      return false;
    },
    description: `Execute a bash command in the user's shell (non-interactive).

WHEN TO USE:
- Running existing project commands (build, test, lint, typecheck)
- Using read-only CLI tools (git status, git diff, ls, etc.)
- Invoking language/package managers (npm, pnpm, yarn, pip, go, etc.) as part of the task

WHEN NOT TO USE:
- Reading files (use readFileTool instead)
- Editing or creating files (use editFileTool or writeFileTool instead)
- Searching code or text (use grepTool and/or globTool instead)
- Interactive commands (shells, editors, REPLs)

USAGE:
- Runs bash -c "<command>" in a non-interactive shell (no TTY/PTY)
- Commands automatically run in the working directory by default — do NOT prepend "cd /path &&" to commands
- NEVER prefix commands with "cd <working-directory> &&" or any path — this is the most common mistake and is always wrong
- Use the cwd parameter ONLY with a workspace-relative subdirectory when you need to run in a different directory
- Commands automatically timeout after ~2 minutes
- Combined stdout/stderr output is truncated after ~50,000 characters

DO NOT USE FOR:
- File reading (cat, head, tail) - use readFileTool
- File editing (sed, awk, editors) - use editFileTool / writeFileTool
- File creation (touch, redirections like >, >>) - use writeFileTool
- Code search (grep, rg, ag) - use grepTool

IMPORTANT:
- Never chain commands with ';' or '&&' - use separate tool calls for each logical step
- Never use interactive commands (vim, nano, top, bash, ssh, etc.)
- Always quote file paths that may contain spaces
- Use detached: true to start dev servers or other long-running processes in the background

EXAMPLES:
- Run the test suite: command: "npm test"
- Check git status: command: "git status --short"
- List files in src: command: "ls -la", cwd: "src"
- Start a dev server: command: "npm run dev", detached: true`,
    inputSchema: bashInputSchema,
    execute: async ({ command, cwd, detached }, { experimental_context }) => {
      const sandbox = await getSandbox(experimental_context, "bash");
      const workingDirectory = sandbox.workingDirectory;

      // Resolve the working directory
      const workingDir = cwd
        ? path.isAbsolute(cwd)
          ? cwd
          : path.resolve(workingDirectory, cwd)
        : workingDirectory;

      // Detached mode: start the command in the background and return immediately
      if (detached) {
        if (!sandbox.execDetached) {
          return {
            success: false,
            exitCode: null,
            stdout: "",
            stderr:
              "Detached mode is not supported in this sandbox environment. Only cloud sandboxes support background processes.",
          };
        }

        try {
          const { commandId } = await sandbox.execDetached(command, workingDir);
          return {
            success: true,
            exitCode: null,
            stdout: `Process started in background (command ID: ${commandId}). The server is now running.`,
            stderr: "",
          };
        } catch (error) {
          return {
            success: false,
            exitCode: null,
            stdout: "",
            stderr: error instanceof Error ? error.message : String(error),
          };
        }
      }

      const result = await sandbox.exec(command, workingDir, TIMEOUT_MS);

      return {
        success: result.success,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        ...(result.truncated && { truncated: true }),
      };
    },
  });
