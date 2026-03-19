import type { FetchFunction } from "@ai-sdk/provider-utils";
import type { UIMessage } from "ai";
import { DefaultChatTransport } from "ai";

/**
 * A chat transport that allows aborting active response streams without
 * killing in-flight request uploads.
 *
 * When `abort()` is called, any active response body readers are cancelled
 * (stopping downstream data consumption and freeing the connection). The
 * request itself is NOT aborted — this ensures the POST body reaches the
 * server even on slow connections (e.g. when the user navigates away while
 * the upload is still in progress).
 *
 * The AI SDK's own abort signal (`init.signal`, fired by `chatInstance.stop()`)
 * still aborts the full fetch request when the user explicitly stops
 * generation.
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
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        // Capture the current abort signal BEFORE the await. abort() swaps
        // in a new controller, so we need the reference that was live when
        // this particular fetch was initiated.
        const transportSignal = state.controller.signal;

        // Only pass the SDK's own signal (init.signal) to fetch — NOT the
        // transport-level signal. This lets the POST body finish uploading on
        // slow connections even when transport.abort() fires on route unmount,
        // while explicit stop (chatInstance.stop()) can still abort via the
        // SDK signal.
        const response = await outerFetch(input, { ...init });

        // Cancel the response body if the transport was already aborted
        // during the request (e.g. user navigated away while uploading), or
        // register a listener to cancel on future abort.
        if (response.body) {
          if (transportSignal.aborted) {
            response.body.cancel().catch(() => {});
          } else {
            transportSignal.addEventListener(
              "abort",
              () => {
                response.body?.cancel().catch(() => {});
              },
              { once: true },
            );
          }
        }

        return response;
      }) as FetchFunction,
    });

    this._state = state;
  }

  /**
   * Cancel every in-flight response body reader, then reset so new
   * requests go through normally. The underlying fetch requests are NOT
   * aborted — only response consumption is stopped, which frees the
   * connection and stops wasting bandwidth.
   */
  abort(): void {
    this._state.controller.abort();
    this._state.controller = new AbortController();
  }
}
