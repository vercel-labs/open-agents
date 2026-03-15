import { nanoid } from "nanoid";
import {
  compareAndSetChatActiveStreamId,
  getChatById,
} from "@/lib/db/sessions";
import { onStopSignal } from "@/lib/stop-signal";

const STREAM_TOKEN_SEPARATOR = ":";
const PRE_TIMEOUT_MS = 730_000;

export function createStreamToken(startedAtMs: number): string {
  return `${startedAtMs}${STREAM_TOKEN_SEPARATOR}${nanoid()}`;
}

function parseStreamTokenStartedAt(streamToken: string | null): number | null {
  if (!streamToken) {
    return null;
  }

  const separatorIndex = streamToken.indexOf(STREAM_TOKEN_SEPARATOR);
  if (separatorIndex <= 0) {
    return null;
  }

  const startedAt = Number(streamToken.slice(0, separatorIndex));
  if (!Number.isFinite(startedAt)) {
    return null;
  }

  return startedAt;
}

export async function claimStreamOwnership(params: {
  chatId: string;
  ownedStreamToken: string;
  requestStartedAtMs: number;
}): Promise<boolean> {
  const { chatId, ownedStreamToken, requestStartedAtMs } = params;

  // Retry once if another request updates activeStreamId between our read and CAS.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const latestChat = await getChatById(chatId);
    const activeStreamId = latestChat?.activeStreamId ?? null;
    const activeStartedAt = parseStreamTokenStartedAt(activeStreamId);

    if (
      activeStartedAt !== null &&
      activeStartedAt > requestStartedAtMs &&
      activeStreamId !== ownedStreamToken
    ) {
      return false;
    }

    const claimed = await compareAndSetChatActiveStreamId(
      chatId,
      activeStreamId,
      ownedStreamToken,
    );

    if (claimed) {
      return true;
    }
  }

  return false;
}

export function createOwnedStreamTokenClearer(
  chatId: string,
  ownedStreamToken: string,
): () => Promise<boolean> {
  let streamTokenCleared = false;

  return async () => {
    if (streamTokenCleared) {
      return false;
    }

    streamTokenCleared = true;
    try {
      return await compareAndSetChatActiveStreamId(
        chatId,
        ownedStreamToken,
        null,
      );
    } catch (error) {
      console.error("Failed to finalize active stream token:", error);
      return false;
    }
  };
}

export interface StreamAbortLifecycle {
  controller: AbortController;
  shouldAutoCommitOnFinish: () => boolean;
  cleanup: () => void;
}

export async function setupStreamAbortLifecycle(
  chatId: string,
): Promise<StreamAbortLifecycle> {
  const controller = new AbortController();
  let shouldAutoCommit = true;

  const unsubscribeStop = await onStopSignal(chatId, () => {
    shouldAutoCommit = false;
    controller.abort();
  });

  const timeoutHandle = setTimeout(() => {
    console.warn("[chat] Aborting before maxDuration timeout");
    shouldAutoCommit = false;
    controller.abort();
  }, PRE_TIMEOUT_MS);

  let cleaned = false;

  return {
    controller,
    shouldAutoCommitOnFinish: () => shouldAutoCommit,
    cleanup: () => {
      if (cleaned) {
        return;
      }

      cleaned = true;
      clearTimeout(timeoutHandle);
      unsubscribeStop();
    },
  };
}
