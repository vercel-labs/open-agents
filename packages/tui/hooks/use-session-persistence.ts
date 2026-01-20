import { useEffect, useRef, useCallback } from "react";
import { isToolUIPart } from "ai";
import type { TUIAgentUIMessage } from "../types";
import { createSession, appendMessage } from "../lib/session-storage";

/**
 * Hook to automatically persist messages to a session file.
 *
 * - Creates a new session on first message if no sessionId provided
 * - Tracks which messages have been persisted
 * - Appends new completed messages to the JSONL file
 *
 * @returns setSessionId callback to update the current session
 */
export function useSessionPersistence(
  messages: TUIAgentUIMessage[],
  sessionId: string | null,
  projectPath: string | null,
  currentBranch: string,
  onSessionCreated: (sessionId: string) => void,
): void {
  // Track how many messages have been persisted
  const persistedCountRef = useRef(0);

  // Track if session creation is in progress to avoid race conditions
  const creatingSessionRef = useRef(false);

  // Persist new messages whenever the messages array changes
  const persistMessages = useCallback(async () => {
    // Skip if no project path configured
    if (!projectPath) return;

    // Find messages that haven't been persisted yet
    const newMessages = messages.slice(persistedCountRef.current);

    // Skip if no new messages
    if (newMessages.length === 0) return;

    // Only persist complete messages (not streaming)
    // A message is complete when:
    // - User messages: always complete
    // - Assistant messages: have at least one part and the last part is complete
    const completeMessages = newMessages.filter((msg) => {
      if (msg.role === "user") return true;

      // For assistant messages, check if the message appears complete
      // We consider it complete if it has parts and isn't obviously streaming
      if (msg.parts.length === 0) return false;

      // Check the last part - if it's a tool call that's still streaming, skip
      const lastPart = msg.parts[msg.parts.length - 1];
      if (!lastPart) return false;

      // Tool calls in streaming states are not complete
      if (isToolUIPart(lastPart)) {
        const toolPart = lastPart as {
          state?: string;
        };
        if (
          toolPart.state === "input-streaming" ||
          toolPart.state === "input-available"
        ) {
          return false;
        }
      }

      return true;
    });

    if (completeMessages.length === 0) return;

    // Create session if needed
    let currentSessionId = sessionId;
    if (!currentSessionId && !creatingSessionRef.current) {
      creatingSessionRef.current = true;
      try {
        currentSessionId = await createSession(projectPath, currentBranch);
        onSessionCreated(currentSessionId);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("Failed to create session:", error);
        creatingSessionRef.current = false;
        return;
      }
      creatingSessionRef.current = false;
    }

    // If still no session (creation might be in progress elsewhere), skip
    if (!currentSessionId) return;

    // Append each complete message
    for (const msg of completeMessages) {
      try {
        await appendMessage(projectPath, currentSessionId, msg, currentBranch);
        persistedCountRef.current++;
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("Failed to persist message:", error);
        // Stop on error to avoid gaps
        break;
      }
    }
  }, [messages, sessionId, projectPath, currentBranch, onSessionCreated]);

  // Run persistence whenever messages change
  useEffect(() => {
    persistMessages();
  }, [persistMessages]);

  // Reset persisted count when session changes (e.g., resuming a different session)
  // oxlint-disable-next-line exhaustive-deps -- intentionally only run when sessionId changes
  useEffect(() => {
    if (sessionId) {
      // When resuming a session, we need to set the persisted count to the current messages length
      // to avoid re-persisting already persisted messages
      persistedCountRef.current = messages.length;
    }
  }, [sessionId]);
}
