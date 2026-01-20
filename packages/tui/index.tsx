import React from "react";
import { render } from "ink";
import { App } from "./app";
import { ChatProvider } from "./chat-context";
import {
  ReasoningProvider,
  ExpandedViewProvider,
  TodoViewProvider,
} from "@open-harness/shared";
import { defaultModelLabel } from "@open-harness/agent";
import { createDefaultAgentOptions } from "./config";
import type { TUIOptions } from "./types";

export type { TUIOptions, AutoAcceptMode, Settings } from "./types";
export { useChatContext, ChatProvider } from "./chat-context";
export { tuiAgent, createDefaultAgentOptions } from "./config";
export { loadSettings, saveSettings } from "./lib/settings";
export { fetchAvailableModels } from "./lib/fetch-models";
export type { ModelInfo } from "./lib/models";

// Session persistence exports
export {
  createSession,
  saveSession,
  listSessions,
  loadSession,
  formatTimeAgo,
  encodeProjectPath,
} from "./lib/session-storage";
export type { SessionListItem, SessionData } from "./lib/session-types";

/**
 * Create a Claude Code-style TUI.
 *
 * The agent is configured in `config.ts` - this is the single source of truth.
 *
 * @example
 * ```ts
 * import { createTUI } from './tui';
 *
 * // Interactive mode
 * await createTUI({
 *   sandbox,
 *   workingDirectory: sandbox.workingDirectory,
 * });
 *
 * // One-shot mode with initial prompt
 * await createTUI({
 *   sandbox,
 *   initialPrompt: "Explain this codebase",
 *   workingDirectory: sandbox.workingDirectory,
 * });
 * ```
 */
export async function createTUI(options: TUIOptions): Promise<void> {
  if (!options.agentOptions && !options.sandbox) {
    throw new Error("createTUI requires agentOptions or a sandbox.");
  }

  const agentOptions =
    options.agentOptions ?? createDefaultAgentOptions(options.sandbox!);

  const workingDirectory =
    options.workingDirectory ?? options.sandbox?.workingDirectory;

  const projectPath = options.projectPath ?? workingDirectory;

  const { waitUntilExit } = render(
    <ChatProvider
      agentOptions={agentOptions}
      model={options.header?.model ?? defaultModelLabel}
      workingDirectory={workingDirectory}
      initialAutoAcceptMode={options.initialAutoAcceptMode}
      initialSettings={options.initialSettings}
      onSettingsChange={options.onSettingsChange}
      availableModels={options.availableModels}
      projectPath={projectPath}
      currentBranch={options.currentBranch}
    >
      <ReasoningProvider>
        <ExpandedViewProvider>
          <TodoViewProvider>
            <App options={options} />
          </TodoViewProvider>
        </ExpandedViewProvider>
      </ReasoningProvider>
    </ChatProvider>,
  );

  await waitUntilExit();
}

/**
 * Render the TUI without waiting for exit.
 * Useful for programmatic control.
 */
export function renderTUI(options: TUIOptions) {
  if (!options.agentOptions && !options.sandbox) {
    throw new Error("renderTUI requires agentOptions or a sandbox.");
  }

  const agentOptions =
    options.agentOptions ?? createDefaultAgentOptions(options.sandbox!);

  const workingDirectory =
    options.workingDirectory ?? options.sandbox?.workingDirectory;

  const projectPath = options.projectPath ?? workingDirectory;

  return render(
    <ChatProvider
      agentOptions={agentOptions}
      model={options.header?.model ?? defaultModelLabel}
      workingDirectory={workingDirectory}
      initialAutoAcceptMode={options.initialAutoAcceptMode}
      initialSettings={options.initialSettings}
      onSettingsChange={options.onSettingsChange}
      availableModels={options.availableModels}
      projectPath={projectPath}
      currentBranch={options.currentBranch}
    >
      <ReasoningProvider>
        <ExpandedViewProvider>
          <TodoViewProvider>
            <App options={options} />
          </TodoViewProvider>
        </ExpandedViewProvider>
      </ReasoningProvider>
    </ChatProvider>,
  );
}

// Re-export components for custom TUI composition
export * from "./components/index";

// Re-export render-tool types and utilities
export * from "./lib/render-tool";

// Re-export transport for custom usage
export { createAgentTransport } from "./transport";
