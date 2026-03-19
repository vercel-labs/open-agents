// Workaround: the ReadableStream returned by the workflow runtime's
// `getReadable()` does not support cancellation. When a client disconnects
// mid-stream the underlying reader is never released, which causes the
// response to hang. This wrapper adds proper cancel() handling and
// treats AbortError / ResponseAborted as clean shutdown so disconnects
// resolve gracefully.

function closeController<T>(controller: ReadableStreamDefaultController<T>) {
  try {
    controller.close();
  } catch {
    // Ignore close races after cancellation.
  }
}

export function createCancelableReadableStream<T>(source: ReadableStream<T>) {
  const reader = source.getReader();
  let isCancelled = false;

  const releaseReader = () => {
    try {
      reader.releaseLock();
    } catch {
      // Ignore release races after stream completion.
    }
  };

  const cancelReader = async () => {
    if (isCancelled) {
      return;
    }

    isCancelled = true;

    try {
      await reader.cancel();
    } catch {
      // Ignore cancellation races during client disconnect cleanup.
    } finally {
      releaseReader();
    }
  };

  return new ReadableStream<T>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();

        if (done) {
          releaseReader();
          closeController(controller);
          return;
        }

        controller.enqueue(value);
      } catch (error) {
        if (isCancelled || isAbortLikeError(error)) {
          releaseReader();
          closeController(controller);
          return;
        }

        controller.error(error);
      }
    },
    async cancel() {
      await cancelReader();
    },
  });
}

function isAbortLikeError(error: unknown) {
  if (error === undefined) {
    return true;
  }

  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "ResponseAborted")
  );
}
