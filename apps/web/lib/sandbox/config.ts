/**
 * Sandbox timeout configuration.
 * All timeout values are in milliseconds.
 */

/** Default timeout for new cloud sandboxes (5 hours) */
export const DEFAULT_SANDBOX_TIMEOUT_MS = 5 * 60 * 60 * 1000;

/** Manual extension duration for explicit fallback flows (20 minutes) */
export const EXTEND_TIMEOUT_DURATION_MS = 20 * 60 * 1000;

/** Inactivity window before lifecycle hibernates an idle sandbox (20 minutes) */
export const SANDBOX_INACTIVITY_TIMEOUT_MS = 20 * 60 * 1000;
