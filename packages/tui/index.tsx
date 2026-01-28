import { defaultModelLabel } from "@open-harness/agent";
import {
  ExpandedViewProvider,
  ReasoningProvider,
  TodoViewProvider,
} from "@open-harness/shared";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import React from "react";
import { App } from "./app";
import { ChatProvider } from "./chat-context";
import { createDefaultAgentOptions } from "./config";
import type { TUIOptions } from "./types";

export { ChatProvider, useChatContext } from "./chat-context";
export { createDefaultAgentOptions, tuiAgent } from "./config";
export { fetchAvailableModels } from "./lib/fetch-models";
export type { ModelInfo } from "./lib/models";
// Session persistence exports
export {
  createSession,
  encodeProjectPath,
  formatTimeAgo,
  listSessions,
  loadSession,
  saveSession,
} from "./lib/session-storage";
export type { SessionData, SessionListItem } from "./lib/session-types";
export { loadSettings, saveSettings } from "./lib/settings";
export type { AutoAcceptMode, Settings, TUIOptions } from "./types";

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

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
  });
  const root = createRoot(renderer);

  root.render(
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
      gateway={options.gateway}
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

  await new Promise<void>((resolve) => {
    renderer.once("destroy", () => resolve());
  });
}

/**
 * Render the TUI without waiting for exit.
 * Useful for programmatic control.
 */
export async function renderTUI(options: TUIOptions) {
  if (!options.agentOptions && !options.sandbox) {
    throw new Error("renderTUI requires agentOptions or a sandbox.");
  }

  const agentOptions =
    options.agentOptions ?? createDefaultAgentOptions(options.sandbox!);

  const workingDirectory =
    options.workingDirectory ?? options.sandbox?.workingDirectory;

  const projectPath = options.projectPath ?? workingDirectory;

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
  });
  const root = createRoot(renderer);

  root.render(
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
      gateway={options.gateway}
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

  return {
    renderer,
    unmount: () => renderer.destroy(),
    waitUntilExit: () =>
      new Promise<void>((resolve) => {
        renderer.once("destroy", () => resolve());
      }),
  };
}

// Re-export components for custom TUI composition
export * from "./components/index";

// Re-export render-tool types and utilities
export * from "./lib/render-tool";

// Re-export transport for custom usage
export { createAgentTransport } from "./transport";
