/**
 * Sandbox timeout configuration.
 * All timeout values are in milliseconds.
 */

import { isHobbyResourceProfile } from "../deployment/resource-profile.ts";

/** SDK safety buffer reserved for sandbox before-stop hooks (30 seconds) */
const VERCEL_SANDBOX_TIMEOUT_BUFFER_MS = 30 * 1000;

/** Standard timeout for new cloud sandboxes (5 hours minus hook buffer) */
const STANDARD_SANDBOX_TIMEOUT_MS =
  5 * 60 * 60 * 1000 - VERCEL_SANDBOX_TIMEOUT_BUFFER_MS;

/** Hobby-compatible timeout for new cloud sandboxes (40 minutes minus hook buffer) */
const HOBBY_SANDBOX_TIMEOUT_MS =
  40 * 60 * 1000 - VERCEL_SANDBOX_TIMEOUT_BUFFER_MS;

/** Default timeout for new cloud sandboxes */
export const DEFAULT_SANDBOX_TIMEOUT_MS = isHobbyResourceProfile()
  ? HOBBY_SANDBOX_TIMEOUT_MS
  : STANDARD_SANDBOX_TIMEOUT_MS;

/** Default vCPU count for new cloud sandboxes */
export const DEFAULT_SANDBOX_VCPUS = isHobbyResourceProfile() ? 1 : 4;

/** Manual extension duration for explicit fallback flows (20 minutes) */
export const EXTEND_TIMEOUT_DURATION_MS = 20 * 60 * 1000;

/** Inactivity window before lifecycle hibernates an idle sandbox (30 minutes) */
export const SANDBOX_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

/** Buffer for sandbox expiry checks (10 seconds) */
export const SANDBOX_EXPIRES_BUFFER_MS = 10 * 1000;

/** Grace window before treating a lifecycle run as stale (2 minutes) */
export const SANDBOX_LIFECYCLE_STALE_RUN_GRACE_MS = 2 * 60 * 1000;

/** Minimum sleep between lifecycle workflow loop iterations (5 seconds) */
export const SANDBOX_LIFECYCLE_MIN_SLEEP_MS = 5 * 1000;

/**
 * Default ports to expose from cloud sandboxes.
 * Limited to 5 ports. Covers the most common framework defaults
 * plus the built-in code editor:
 * - 3000: Next.js, Express, Remix
 * - 5173: Vite, SvelteKit
 * - 4321: Astro
 * - 8000: code-server (built-in editor)
 */
export const DEFAULT_SANDBOX_PORTS = [3000, 5173, 4321, 8000];
export const CODE_SERVER_PORT = 8000;

/** Default working directory for sandboxes, used for path display */
export const DEFAULT_WORKING_DIRECTORY = "/vercel/sandbox";

/**
 * Optional base snapshot for fresh cloud sandboxes.
 *
 * Forked deployments should provide their own snapshot ID if they want a
 * preconfigured image. When unset, sandboxes start from Vercel's standard
 * runtime so deployments are not tied to a private snapshot in another scope.
 */
export const DEFAULT_SANDBOX_BASE_SNAPSHOT_ID =
  process.env.VERCEL_SANDBOX_BASE_SNAPSHOT_ID;
