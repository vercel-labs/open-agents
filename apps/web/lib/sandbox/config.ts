/**
 * Sandbox timeout configuration.
 * All timeout values are in milliseconds.
 */

/** Default timeout for new sandboxes (5 minutes) */
export const DEFAULT_SANDBOX_TIMEOUT_MS = 300_000;

/** Duration to extend timeout by when user requests more time (5 minutes) */
export const EXTEND_TIMEOUT_DURATION_MS = 300_000;

/** Threshold for auto-extending sandbox when window is focused (60 seconds before expiry) */
export const AUTO_EXTEND_THRESHOLD_MS = 60_000;
