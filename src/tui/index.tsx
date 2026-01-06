import React from "react";
import { render } from "ink";
import { App } from "./app.js";
import { ChatProvider } from "./chat-context.js";
import { ReasoningProvider } from "./reasoning-context.js";
import { ExpandedViewProvider } from "./expanded-view-context.js";
import { TodoViewProvider } from "./todo-view-context.js";
import { tuiAgentModelId, createDefaultAgentOptions } from "./config.js";
import type { TUIOptions } from "./types.js";

export type { TUIOptions, AutoAcceptMode } from "./types.js";
export { useChatContext, ChatProvider } from "./chat-context.js";
export { useReasoningContext, ReasoningProvider } from "./reasoning-context.js";
export {
  useExpandedView,
  ExpandedViewProvider,
} from "./expanded-view-context.js";
export { useTodoView, TodoViewProvider } from "./todo-view-context.js";
export {
  tuiAgent,
  tuiAgentModelId,
  createDefaultAgentOptions,
} from "./config.js";

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
 * await createTUI({ workingDirectory: process.cwd() });
 *
 * // One-shot mode with initial prompt
 * await createTUI({
 *   initialPrompt: "Explain this codebase",
 *   workingDirectory: process.cwd(),
 * });
 * ```
 */
export async function createTUI(options: TUIOptions): Promise<void> {
  const agentOptions =
    options.agentOptions ??
    createDefaultAgentOptions(options.workingDirectory ?? process.cwd());

  const { waitUntilExit } = render(
    <ChatProvider
      agentOptions={agentOptions}
      model={options.header?.model ?? tuiAgentModelId}
      workingDirectory={options.workingDirectory}
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
  const agentOptions =
    options.agentOptions ??
    createDefaultAgentOptions(options.workingDirectory ?? process.cwd());

  return render(
    <ChatProvider
      agentOptions={agentOptions}
      model={options.header?.model ?? tuiAgentModelId}
      workingDirectory={options.workingDirectory}
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
export * from "./components/index.js";

// Re-export transport for custom usage
export { createAgentTransport } from "./transport.js";
