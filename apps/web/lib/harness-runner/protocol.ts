import type {
  ExternalHarnessId,
  HarnessTurnResult,
  HarnessUIMessage,
  HarnessUIMessageChunk,
} from "@open-agents/harness-runner";
import type { SandboxState } from "@open-agents/sandbox";

export type InternalHarnessRunRequest = {
  harnessId: ExternalHarnessId;
  sandboxState: SandboxState;
  workingDirectory: string;
  sessionId: string;
  messageId: string;
  messages: HarnessUIMessage[];
  originalMessages: HarnessUIMessage[];
  selectedModelId: string;
  modelId: string;
  /** Harness session state persisted from the previous turn, if any. */
  resumeState?: unknown;
};

export type InternalHarnessRunEvent =
  | {
      type: "chunk";
      chunk: HarnessUIMessageChunk;
    }
  | {
      type: "result";
      result: HarnessTurnResult;
    }
  | {
      type: "error";
      error: string;
    };
