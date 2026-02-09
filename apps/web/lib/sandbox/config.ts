/**
 * Sandbox timeout configuration.
 * All timeout values are in milliseconds.
 */

// /** Default timeout for new cloud sandboxes (5 hours) */
// export const DEFAULT_SANDBOX_TIMEOUT_MS = 5 * 60 * 60 * 1000;

/** Manual extension duration for explicit fallback flows (1 hour) */
export const EXTEND_TIMEOUT_DURATION_MS = 60 * 60 * 1000;

// /** Inactivity window before lifecycle hibernates an idle sandbox (30 minutes) */
// export const SANDBOX_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
//
// /** Guard window before hard timeout to trigger snapshot/rollover (2 minutes) */
// export const SANDBOX_HARD_TIMEOUT_GUARD_MS = 2 * 60 * 1000;
//


export const DEFAULT_SANDBOX_TIMEOUT_MS = 3 * 60 * 1000;
export const SANDBOX_INACTIVITY_TIMEOUT_MS = 60 * 1000;
export const SANDBOX_HARD_TIMEOUT_GUARD_MS = 30 * 1000;

// for testing roll over
// export const DEFAULT_SANDBOX_TIMEOUT_MS = 3 * 60 * 1000;
// export const SANDBOX_HARD_TIMEOUT_GUARD_MS = 30 * 1000;
// export const SANDBOX_INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
