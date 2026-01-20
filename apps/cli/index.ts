#!/usr/bin/env node

import { execSync } from "node:child_process";
import { defaultModelLabel } from "@open-harness/agent";
import {
  createTUI,
  loadSettings,
  saveSettings,
  fetchAvailableModels,
  type Settings,
} from "@open-harness/tui";
import { loadAgentsMd } from "./agents-md";
import { onCleanup, cleanup } from "./cleanup-handler";
import {
  createSandbox,
  parseSandboxType,
  type SandboxType,
} from "./sandbox-factory";
import { showSpinner } from "./spinner";

/**
 * Get the current git branch for a directory.
 * Returns empty string if not a git repo or git is not available.
 */
function getCurrentGitBranch(workingDirectory: string): string {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: workingDirectory,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return branch;
  } catch {
    return "";
  }
}

function printHelp() {
  console.log("Deep Agent CLI");
  console.log("");
  console.log("Usage:");
  console.log("  deep-agent [options]              Start interactive REPL");
  console.log("  deep-agent [options] <prompt>     Run a one-shot prompt");
  console.log("");
  console.log("Options:");
  console.log("  --sandbox=<type>  Sandbox to use: local (default), vercel");
  console.log("  --repo=<repo>     GitHub repo to clone (e.g., vercel/ai)");
  console.log("  --help, -h        Show this help message");
  console.log("");
  console.log("Environment variables (for --sandbox=vercel):");
  console.log("  GITHUB_TOKEN        GitHub PAT for private repos (optional)");
  console.log("  SANDBOX_BRANCH      Branch to clone (optional)");
  console.log("  SANDBOX_NEW_BRANCH  New branch to create (optional)");
  console.log("");
  console.log("Examples:");
  console.log('  deep-agent "Explain the structure of this codebase"');
  console.log("  deep-agent --sandbox=vercel");
  console.log("  deep-agent --sandbox=vercel --repo=vercel/ai");
  console.log('  deep-agent --sandbox=vercel --repo=vercel/ai "Fix the bug"');
  console.log("");
  console.log("Keyboard shortcuts:");
  console.log("  esc           Abort current operation / exit");
  console.log("  ctrl+c        Force exit");
  console.log("  shift+tab     Cycle auto-accept mode");
  console.log("  ctrl+r        Expand tool output (when available)");
}

interface ParsedArgs {
  sandboxType: SandboxType;
  repo?: string;
  initialPrompt?: string;
  showHelp: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  let sandboxType: SandboxType = "local";
  let repo: string | undefined;
  let showHelp = false;
  const promptParts: string[] = [];

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      showHelp = true;
    } else if (arg.startsWith("--sandbox=")) {
      const value = arg.slice("--sandbox=".length);
      sandboxType = parseSandboxType(value);
    } else if (arg.startsWith("--repo=")) {
      repo = arg.slice("--repo=".length);
    } else if (arg.startsWith("--")) {
      // Unknown flag - treat as part of prompt for backwards compatibility
      promptParts.push(arg);
    } else {
      promptParts.push(arg);
    }
  }

  return {
    sandboxType,
    repo,
    initialPrompt: promptParts.length > 0 ? promptParts.join(" ") : undefined,
    showHelp,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const workingDirectory = process.cwd();

  const parsed = parseArgs(args);

  if (parsed.showHelp) {
    printHelp();
    process.exit(0);
  }

  let sandbox: Awaited<ReturnType<typeof createSandbox>> | undefined;
  const isRemoteSandbox = parsed.sandboxType !== "local";

  // Register cleanup for remote sandboxes
  if (isRemoteSandbox) {
    onCleanup(async () => {
      if (sandbox) {
        const spinner = showSpinner("Stopping sandbox...");
        try {
          await sandbox.stop();
        } finally {
          spinner.stop();
        }
      }
    });
  }

  try {
    // Create the appropriate sandbox
    let spinner: ReturnType<typeof showSpinner> | undefined;
    if (isRemoteSandbox) {
      const message = parsed.repo
        ? `Starting sandbox (cloning ${parsed.repo})...`
        : "Starting sandbox...";
      spinner = showSpinner(message);
    }

    try {
      sandbox = await createSandbox({
        type: parsed.sandboxType,
        workingDirectory,
        repo: parsed.repo,
      });
    } finally {
      spinner?.stop();
    }

    // Load agents.md files from the working directory hierarchy
    const agentsMd = await loadAgentsMd(workingDirectory);

    // Load user settings and available models in parallel
    const [settings, availableModels] = await Promise.all([
      loadSettings(),
      fetchAvailableModels(),
    ]);

    // Callback to save settings when they change
    const handleSettingsChange = (newSettings: Settings) => {
      saveSettings(newSettings).catch((err) => {
        console.error("Failed to save settings:", err);
      });
    };

    // Get the current git branch - prefer sandbox's branch, fallback to local git
    const currentBranch =
      sandbox.currentBranch ?? getCurrentGitBranch(workingDirectory);

    await createTUI({
      initialPrompt: parsed.initialPrompt,
      workingDirectory: sandbox.workingDirectory,
      projectPath: workingDirectory,
      currentBranch,
      header: {
        name: "Open Harness",
        version: "0.1.0",
        model: defaultModelLabel,
      },
      agentOptions: {
        sandbox,
        approval: {
          type: "interactive",
          autoApprove: "off",
          sessionRules: [],
        },
        ...(agentsMd?.content && {
          customInstructions: agentsMd.content,
        }),
      },
      initialSettings: settings,
      onSettingsChange: handleSettingsChange,
      availableModels,
      // Auto-accept all tools in sandbox mode since it's an isolated environment
      ...(isRemoteSandbox && { initialAutoAcceptMode: "all" }),
    });
  } catch (error) {
    // Ignore abort errors from ESC key interrupts
    if (error instanceof Error && error.name === "AbortError") {
      return;
    }
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    await cleanup();
  }
}

main();
