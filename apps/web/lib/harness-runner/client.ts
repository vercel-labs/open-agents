import type {
  HarnessTurnResult,
  HarnessUIMessageChunk,
} from "@open-agents/harness-runner";
import {
  INTERNAL_HARNESS_SIGNATURE_HEADER,
  signInternalHarnessRequest,
} from "./internal-request";
import {
  type InternalHarnessRunEvent,
  type InternalHarnessRunRequest,
  internalHarnessRunEventSchema,
} from "./protocol";

/**
 * Runs one harness turn through the internal harness-runner route instead of
 * calling `runHarnessTurn` in-process: the harness bridge assets and
 * externalized packages are only traced into that route's bundle (see the
 * `outputFileTracingIncludes` comment in `apps/web/next.config.ts`).
 */
type RunHarnessTurnViaApiInput = InternalHarnessRunRequest & {
  requestUrl: string;
  abortSignal?: AbortSignal;
  onChunk: (chunk: HarnessUIMessageChunk) => Promise<void> | void;
};

async function processEvent(
  event: InternalHarnessRunEvent,
  input: Pick<RunHarnessTurnViaApiInput, "onChunk">,
): Promise<HarnessTurnResult | undefined> {
  if (event.type === "chunk") {
    await input.onChunk(event.chunk);
    return;
  }

  if (event.type === "error") {
    throw new Error(event.error);
  }

  return event.result;
}

export async function runHarnessTurnViaApi(
  input: RunHarnessTurnViaApiInput,
): Promise<HarnessTurnResult> {
  const requestBody: InternalHarnessRunRequest = {
    harnessId: input.harnessId,
    sandboxState: input.sandboxState,
    workingDirectory: input.workingDirectory,
    sessionId: input.sessionId,
    messageId: input.messageId,
    messages: input.messages,
    originalMessages: input.originalMessages,
    selectedModelId: input.selectedModelId,
    modelId: input.modelId,
    ...(input.resumeState !== undefined
      ? { resumeState: input.resumeState }
      : {}),
  };
  const body = JSON.stringify(requestBody);
  const response = await fetch(
    new URL("/api/internal/harness-runner", input.requestUrl),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [INTERNAL_HARNESS_SIGNATURE_HEADER]: signInternalHarnessRequest(body),
        ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET
          ? {
              "x-vercel-protection-bypass":
                process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
            }
          : {}),
        ...(process.env.VERCEL_OIDC_TOKEN
          ? {
              "x-vercel-trusted-oidc-idp-token": process.env.VERCEL_OIDC_TOKEN,
            }
          : {}),
      },
      body,
      ...(input.abortSignal ? { signal: input.abortSignal } : {}),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Harness runner request failed (${response.status}): ${await response.text()}`,
    );
  }
  if (!response.body) {
    throw new Error("Harness runner response did not include a stream");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: HarnessTurnResult | undefined;

  const processLine = async (line: string) => {
    if (!line.trim()) {
      return;
    }
    const event = internalHarnessRunEventSchema.parse(JSON.parse(line));
    result = (await processEvent(event, input)) ?? result;
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      await processLine(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }

    if (done) {
      break;
    }
  }
  await processLine(buffer);

  if (!result) {
    throw new Error("Harness runner stream finished without a result");
  }
  return result;
}
