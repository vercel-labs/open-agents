import type {
  AiSdkHarnessSandboxProvider,
  Sandbox,
} from "@open-agents/sandbox";
import { connectSandbox } from "@open-agents/sandbox";
import {
  ensureGatewayApiKeyEnv,
  isExternalHarnessId,
  runHarnessTurn,
} from "@open-agents/harness-runner";
import {
  INTERNAL_HARNESS_SIGNATURE_HEADER,
  verifyInternalHarnessRequest,
} from "@/lib/harness-runner/internal-request";
import type {
  InternalHarnessRunEvent,
  InternalHarnessRunRequest,
} from "@/lib/harness-runner/protocol";
import {
  AGENT_HARNESS_BRIDGE_PORTS,
  DEFAULT_SANDBOX_PORTS,
} from "@/lib/sandbox/config";

export const maxDuration = 800;

type HarnessCapableSandbox = Sandbox & {
  toHarnessSandboxProvider(
    bridgePorts?: ReadonlyArray<number>,
  ): AiSdkHarnessSandboxProvider;
};

function isHarnessCapableSandbox(
  sandbox: Sandbox,
): sandbox is HarnessCapableSandbox {
  return (
    "toHarnessSandboxProvider" in sandbox &&
    typeof sandbox.toHarnessSandboxProvider === "function"
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(request: Request) {
  const bodyText = await request.text();
  if (
    !verifyInternalHarnessRequest(
      bodyText,
      request.headers.get(INTERNAL_HARNESS_SIGNATURE_HEADER),
    )
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let input: InternalHarnessRunRequest;
  try {
    input = JSON.parse(bodyText) as InternalHarnessRunRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!isExternalHarnessId(input.harnessId)) {
    return Response.json({ error: "Invalid harness" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  // TransformStream + awaited writes couple the harness's chunk production
  // to the HTTP reader, so a slow consumer applies backpressure instead of
  // buffering the whole turn in memory.
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const send = async (event: InternalHarnessRunEvent) => {
    try {
      await writer.write(encoder.encode(`${JSON.stringify(event)}\n`));
    } catch {
      // The caller disconnected; request.signal will abort the harness run.
    }
  };

  void (async () => {
    try {
      // Refresh the gateway credential before connecting: connecting
      // rebuilds the sandbox network policy from the environment, and a
      // token stored by an earlier run may already be expired.
      await ensureGatewayApiKeyEnv();
      const sandbox = await connectSandbox(input.sandboxState, {
        ports: DEFAULT_SANDBOX_PORTS,
      });
      if (!isHarnessCapableSandbox(sandbox)) {
        throw new Error(
          "Configured sandbox provider does not support external harnesses",
        );
      }

      const result = await runHarnessTurn({
        harnessId: input.harnessId,
        sandboxProvider: sandbox.toHarnessSandboxProvider(
          AGENT_HARNESS_BRIDGE_PORTS,
        ),
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
        abortSignal: request.signal,
        onChunk: (chunk) => send({ type: "chunk", chunk }),
      });
      await send({ type: "result", result });
    } catch (error) {
      console.error("[harness-runner] Harness turn failed:", error);
      await send({ type: "error", error: getErrorMessage(error) });
    } finally {
      try {
        await writer.close();
      } catch {
        // The stream was already cancelled by the caller.
      }
    }
  })();

  return new Response(readable, {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}
