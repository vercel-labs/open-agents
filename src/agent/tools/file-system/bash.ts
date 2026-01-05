import { tool } from "ai";
import { z } from "zod";
import * as path from "path";
import { isPathWithinDirectory, getSandbox, sharedContext } from "../../utils";

const TIMEOUT_MS = 120_000;

const bashInputSchema = z.object({
  command: z.string().describe("The bash command to execute"),
  cwd: z
    .string()
    .optional()
    .describe("Working directory for the command (absolute path)"),
});

type BashInput = z.infer<typeof bashInputSchema>;
type ApprovalFn = (args: BashInput) => boolean | Promise<boolean>;

interface ToolOptions {
  needsApproval?: boolean | ApprovalFn;
}

/**
 * Check if the cwd parameter is outside the working directory.
 * If cwd is not provided, it defaults to working directory (no approval needed for path).
 */
function cwdIsOutsideWorkingDirectory(cwd: string | undefined): boolean {
  if (!cwd) {
    return false;
  }
  const absoluteCwd = path.isAbsolute(cwd)
    ? cwd
    : path.resolve(sharedContext.workingDirectory, cwd);
  return !isPathWithinDirectory(absoluteCwd, sharedContext.workingDirectory);
}

/**
 * Check if a command matches any command-prefix approval rules.
 */
function commandMatchesApprovalRule(command: string): boolean {
  const trimmedCommand = command.trim();
  for (const rule of sharedContext.approvalRules) {
    if (rule.type === "command-prefix" && rule.tool === "bash") {
      if (trimmedCommand.startsWith(rule.prefix)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Create a combined approval function for bash operations.
 * Always requires approval if cwd is outside working directory,
 * then checks command safety and user-provided option.
 * In background mode, auto-approve all operations (except outside working directory).
 * When autoApprove is "all", auto-approve bash commands within working directory.
 */
function createBashApprovalFn(options?: ToolOptions): ApprovalFn {
  return async (args) => {
    // Always need approval if cwd is outside working directory (even in background mode)
    if (cwdIsOutsideWorkingDirectory(args.cwd)) {
      return true;
    }

    // In background mode, auto-approve all operations within working directory
    if (sharedContext.mode === "background") {
      return false;
    }

    // Auto-approve all bash commands when autoApprove is "all"
    if (sharedContext.autoApprove === "all") {
      return false;
    }

    // Check if command matches any saved approval rules
    if (commandMatchesApprovalRule(args.command)) {
      return false;
    }

    // Check command safety
    if (commandNeedsApproval(args.command)) {
      // If command is dangerous, check user's approval setting
      if (typeof options?.needsApproval === "function") {
        return options.needsApproval(args);
      }
      return options?.needsApproval ?? true;
    }

    // Command is safe - no approval needed
    return false;
  };
}

// Read-only commands that are safe to run without approval
const SAFE_COMMAND_PREFIXES = [
  "ls",
  "cat",
  "head",
  "tail",
  "find",
  "grep",
  "rg",
  "git status",
  "git log",
  "git diff",
  "git show",
  "git branch",
  "git remote",
  "pwd",
  "echo",
  "which",
  "type",
  "file",
  "wc",
  "tree",
];

// Commands that should always require approval
const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\b/,
  /\bmv\b/,
  /\bcp\b/,
  /\bmkdir\b/,
  /\btouch\b/,
  /\bchmod\b/,
  /\bchown\b/,
  /\bsudo\b/,
  /\bgit\s+(push|commit|add|reset|checkout|merge|rebase|stash)/,
  /\bnpm\s+(install|uninstall|publish)/,
  /\bpnpm\s+(install|uninstall|publish)/,
  /\byarn\s+(add|remove|publish)/,
  /\bbun\s+(add|remove|install)/,
  /\bpip\s+install/,
  />/,  // redirects
  /\|/,  // pipes (could be dangerous)
  /&&/,  // command chaining
  /;/,   // command chaining
];

/**
 * Check if a command is safe to run without approval.
 * Returns true if approval is needed, false if safe.
 */
export function commandNeedsApproval(command: string): boolean {
  const trimmedCommand = command.trim();
  
  // Check for dangerous patterns first
  for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
    if (pattern.test(trimmedCommand)) {
      return true;
    }
  }
  
  // Check if it starts with a safe command
  for (const prefix of SAFE_COMMAND_PREFIXES) {
    if (trimmedCommand.startsWith(prefix)) {
      return false;
    }
  }
  
  // Default to requiring approval for unknown commands
  return true;
}

export const bashTool = (options?: ToolOptions) => tool({
  needsApproval: createBashApprovalFn(options),
  description: `Execute a bash command in the user's shell (non-interactive).

WHEN TO USE:
- Running existing project commands (build, test, lint, typecheck)
- Using read-only CLI tools (git status, git diff, ls, etc.)
- Invoking language/package managers (npm, pnpm, yarn, pip, go, etc.) as part of the task

WHEN NOT TO USE:
- Reading files (use readFileTool instead)
- Editing or creating files (use editFileTool or writeFileTool instead)
- Searching code or text (use grepTool and/or globTool instead)
- Interactive commands (shells, editors, REPLs) or long-lived daemons

USAGE:
- Runs bash -c "<command>" in a non-interactive shell (no TTY/PTY)
- Commands automatically timeout after ~2 minutes
- Combined stdout/stderr output is truncated after ~50,000 characters
- Use cwd to run in a specific directory; otherwise the current working directory is used

DO NOT USE FOR:
- File reading (cat, head, tail) - use readFileTool
- File editing (sed, awk, editors) - use editFileTool / writeFileTool
- File creation (touch, redirections like >, >>) - use writeFileTool
- Code search (grep, rg, ag) - use grepTool

IMPORTANT:
- Never chain commands with ';' or '&&' - use separate tool calls for each logical step
- Never use interactive commands (vim, nano, top, bash, ssh, etc.)
- Never start background processes with '&'
- Always quote file paths that may contain spaces
- Setting cwd to a path outside the working directory requires approval

EXAMPLES:
- Run the test suite: command: "npm test", cwd: "/Users/username/project"
- Check git status: command: "git status --short"
- List files in src: command: "ls -la", cwd: "/Users/username/project/src"`,
  inputSchema: bashInputSchema,
  execute: async ({ command, cwd }, { experimental_context }) => {
    const sandbox = getSandbox(experimental_context);
    const workingDirectory = sandbox.workingDirectory;

    // Resolve the working directory
    const workingDir = cwd
      ? (path.isAbsolute(cwd) ? cwd : path.resolve(workingDirectory, cwd))
      : workingDirectory;

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
