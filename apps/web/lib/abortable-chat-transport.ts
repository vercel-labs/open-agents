import type { UIMessage } from "ai";
import {
  WorkflowChatTransport,
  type WorkflowChatTransportOptions,
} from "@workflow/ai";

type RequestBody = Record<string, unknown>;
type RequestBodyFactory = () => RequestBody;

type FetchFunction = typeof globalThis.fetch;
type AbortableWorkflowChatTransportOptions<UI_MESSAGE extends UIMessage> =
  WorkflowChatTransportOptions<UI_MESSAGE> & {
    body?: RequestBody | RequestBodyFactory;
  };

function resolveBody(body: RequestBody | RequestBodyFactory | undefined) {
  return typeof body === "function" ? body() : body;
}

function mergeHeaders(...headerInits: Array<HeadersInit | undefined>) {
  const headers = new Headers();
  for (const headerInit of headerInits) {
    if (!headerInit) continue;

    new Headers(headerInit).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return headers;
}

/**
 * A chat transport that allows aborting ALL active fetch connections,
 * including `reconnectToStream` requests.
 *
 * The Workflow transport tracks stream chunk indexes across reconnects so the
 * client resumes from the last received chunk instead of replaying the stream
 * from the beginning. This wrapper keeps that behavior while adding a
 * transport-level abort signal for route cleanup and explicit stops.
 *
 * After `abort()` the transport is immediately reusable — a fresh controller
 * is created so that subsequent fetches are not affected. This makes it safe
 * to call from React effect cleanup (including Strict Mode double-mounts).
 */
export class AbortableChatTransport<
  UI_MESSAGE extends UIMessage = UIMessage,
> extends WorkflowChatTransport<UI_MESSAGE> {
  private _state: { controller: AbortController };

  constructor(options: AbortableWorkflowChatTransportOptions<UI_MESSAGE>) {
    // Mutable ref so the fetch wrapper always reads the *current* controller,
    // even after abort() swaps it out.
    const state = { controller: new AbortController() };
    const outerFetch: FetchFunction = options?.fetch ?? globalThis.fetch;

    const fetchWithAbort: FetchFunction = Object.assign(
      (
        input: Parameters<FetchFunction>[0],
        init?: Parameters<FetchFunction>[1],
      ) =>
        outerFetch(input, {
          ...init,
          signal: init?.signal
            ? AbortSignal.any([state.controller.signal, init.signal])
            : state.controller.signal,
        }),
      {
        preconnect: outerFetch.preconnect,
      },
    );

    super({
      ...options,
      fetch: fetchWithAbort,
      prepareSendMessagesRequest: async (request) => {
        const prepared = await options.prepareSendMessagesRequest?.(request);
        const configuredBody = resolveBody(options.body);
        return {
          ...prepared,
          headers: mergeHeaders(request.headers, prepared?.headers),
          body: {
            ...configuredBody,
            ...request.body,
            messages: request.messages,
            ...prepared?.body,
          },
        };
      },
    });

    this._state = state;
  }

  override async reconnectToStream(
    options: Parameters<
      WorkflowChatTransport<UI_MESSAGE>["reconnectToStream"]
    >[0],
  ) {
    try {
      return await super.reconnectToStream(options);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Failed to fetch chat: 204")
      ) {
        return null;
      }

      throw error;
    }
  }

  /**
   * Abort every in-flight fetch made through this transport, then reset
   * so new requests go through normally.
   */
  abort(): void {
    this._state.controller.abort();
    this._state.controller = new AbortController();
  }
}
