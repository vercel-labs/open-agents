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

export function createStreamOwnershipManager(params: {
  chatId: string;
  requestStartedAtMs: number;
  streamToken: string;
}): {
  claimStreamOwnership: () => Promise<boolean>;
  clearOwnedStreamToken: () => Promise<boolean>;
} {
  const { chatId, requestStartedAtMs, streamToken } = params;
  let streamTokenCleared = false;

  const claimStreamOwnership = async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const latestChat = await getChatById(chatId);
      const activeStreamId = latestChat?.activeStreamId ?? null;
      const activeStartedAt = parseStreamTokenStartedAt(activeStreamId);

      if (
        activeStartedAt !== null &&
        activeStartedAt > requestStartedAtMs &&
        activeStreamId !== streamToken
      ) {
        return false;
      }

      const claimed = await compareAndSetChatActiveStreamId(
        chatId,
        activeStreamId,
        streamToken,
      );

      if (claimed) {
        return true;
      }
    }

    return false;
  };

  const clearOwnedStreamToken = async () => {
    if (streamTokenCleared) {
      return false;
    }

    streamTokenCleared = true;

    try {
      return await compareAndSetChatActiveStreamId(chatId, streamToken, null);
    } catch (error) {
      console.error("Failed to finalize active stream token:", error);
      return false;
    }
  };

  return {
    claimStreamOwnership,
    clearOwnedStreamToken,
  };
}

export async function setupGenerationAbortControl(chatId: string): Promise<{
  controller: AbortController;
  shouldAutoCommitOnFinish: () => boolean;
  close: () => void;
}> {
  const controller = new AbortController();
  let shouldAutoCommitOnFinish = true;

  const unsubscribeStop = await onStopSignal(chatId, () => {
    shouldAutoCommitOnFinish = false;
    controller.abort();
  });

  const timeoutHandle = setTimeout(() => {
    console.warn("[chat] Aborting before maxDuration timeout");
    shouldAutoCommitOnFinish = false;
    controller.abort();
  }, PRE_TIMEOUT_MS);

  let closed = false;

  const close = () => {
    if (closed) {
      return;
    }

    closed = true;
    clearTimeout(timeoutHandle);
    unsubscribeStop();
  };

  return {
    controller,
    shouldAutoCommitOnFinish: () => shouldAutoCommitOnFinish,
    close,
  };
}
