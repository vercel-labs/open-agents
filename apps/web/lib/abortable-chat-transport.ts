import type { FetchFunction } from "@ai-sdk/provider-utils";
import type { UIMessage } from "ai";
import { DefaultChatTransport } from "ai";

/**
 * A chat transport that allows aborting ALL active fetch connections,
 * including `reconnectToStream` requests.
 *
 * The AI SDK's `reconnectToStream` does not pass an abort signal to its
 * internal fetch call, so `chatInstance.stop()` cannot cancel resumed
 * streams. This transport wraps every fetch with a transport-level abort
 * signal so that `abort()` reliably tears down any active connection.
 *
 * After `abort()` the transport is immediately reusable — a fresh controller
 * is created so that subsequent fetches are not affected. This makes it safe
 * to call from React effect cleanup (including Strict Mode double-mounts).
 */
export class AbortableChatTransport<
  UI_MESSAGE extends UIMessage = UIMessage,
> extends DefaultChatTransport<UI_MESSAGE> {
  private _state: { controller: AbortController };

  constructor(
    options: ConstructorParameters<typeof DefaultChatTransport<UI_MESSAGE>>[0],
  ) {
    // Mutable ref so the fetch wrapper always reads the *current* controller,
    // even after abort() swaps it out.
    const state = { controller: new AbortController() };
    const outerFetch: FetchFunction = options?.fetch ?? globalThis.fetch;

    super({
      ...options,
      fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
        outerFetch(input, {
          ...init,
          signal: init?.signal
            ? AbortSignal.any([state.controller.signal, init.signal])
            : state.controller.signal,
        })) as FetchFunction,
    });

    this._state = state;
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
