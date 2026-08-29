/**
 * Detects the durable stream conflict raised when a finish/close step re-runs
 * after the workflow crashed between the stream PUT succeeding and the step
 * result being journaled. The stream is already in the goal state, so steps
 * that only finish or close the stream can treat this as success.
 */
export function isStreamAlreadyCompletedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.message.includes("HTTP 409") &&
    error.message.includes("already completed")
  );
}
