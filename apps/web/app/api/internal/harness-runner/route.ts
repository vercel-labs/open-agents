import type {
  AiSdkHarnessSandboxProvider,
  Sandbox,
} from "@open-agents/sandbox";
import { connectSandbox } from "@open-agents/sandbox";
import {
  ensureGatewayApiKeyEnv,
  runHarnessTurn,
} from "@open-agents/harness-runner";
import { withInternalRouteGuard } from "@/lib/harness-runner/internal-route";
import {
  type InternalHarnessRunEvent,
  type InternalHarnessRunRequest,
  internalHarnessRunRequestSchema,
} from "@/lib/harness-runner/protocol";
import {
  AGENT_HARNESS_BRIDGE_PORTS,
  DEFAULT_SANDBOX_PORTS,
} from "@/lib/sandbox/config";

export const maxDuration = 800;

// Why an HTTP route instead of the workflow step calling `runHarnessTurn`
// directly: the harness bridge assets and externalized packages can only be
// attached to a route via `outputFileTracingIncludes`/`serverExternalPackages`
// in `apps/web/next.config.ts` (see the comment there), not to a workflow
// step bundle.
//
// The route is therefore reachable over the public internet, and it is this
// module that keeps it safe: `withInternalRouteGuard` runs inside the route
// bundle, so every request — whatever reached it, however — must carry a fresh
// HMAC over its own method, path, and body keyed by `INTERNAL_HARNESS_SECRET`.
// Only the deployment itself holds that secret, so only its own workflow steps
// can start a harness turn. `proxy.ts` drops the same traffic earlier as a
// pure optimization (it saves booting an 800s function); removing it must not
// change what this route accepts. See `lib/harness-runner/internal-route.ts`.
//
// `POST` is the only handler exported, so Next answers `405` for every other
// verb. That is left as is: the verb a request arrives with is signed material,
// so the restriction that matters is enforced by the HMAC, not by a route
// pretending not to exist.

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

// The guard stamps `cache-control: no-store` onto whatever this handler
// returns, so responses below only set their own headers.
function errorResponse(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

// Only reached once the guard has authenticated the request, which is also
// where `bodyText` comes from: the handler never sees an unverified body.
export const POST = withInternalRouteGuard(async (request, bodyText) => {
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(bodyText);
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }
  const parsedInput = internalHarnessRunRequestSchema.safeParse(parsedBody);
  if (!parsedInput.success) {
    return errorResponse(`Invalid request: ${parsedInput.error.message}`, 400);
  }
  const input: InternalHarnessRunRequest = parsedInput.data;

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
      // Refresh the gateway credential before connecting, and hand it to
      // `connectSandbox` explicitly. AI Gateway brokering is opt-in per
      // connect (see `buildDefaultCredentialBrokeringPolicy` in
      // `packages/sandbox/vercel/sandbox.ts`): this is the only caller that
      // asks for it, so it is the only path that gives a sandbox the
      // deployment's gateway credential — for the turn it is about to run,
      // rather than for every sandbox this deployment ever touches. A token
      // stored by an earlier run may already be expired, hence the refresh.
      const aiGatewayApiKey = await ensureGatewayApiKeyEnv();
      const sandbox = await connectSandbox(input.sandboxState, {
        ports: DEFAULT_SANDBOX_PORTS,
        ...(aiGatewayApiKey ? { aiGatewayApiKey } : {}),
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
      "x-accel-buffering": "no",
    },
  });
});
