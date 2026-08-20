/**
 * Constants shared by every layer that fronts an internal, server-to-server
 * endpoint: the proxy that filters external traffic, the workflow-side client
 * that signs calls, and the route handler that verifies them.
 *
 * This module stays dependency-free on purpose. `proxy.ts` imports it, and the
 * proxy bundle must not pull in `node:crypto` (or anything else) through it.
 */

/** Header carrying the HMAC signature for internal harness-runner calls. */
export const INTERNAL_HARNESS_SIGNATURE_HEADER =
  "x-open-agents-harness-signature";

/** Route the chat workflow's harness step calls to run one harness turn. */
export const INTERNAL_HARNESS_RUNNER_PATH = "/api/internal/harness-runner";

/**
 * Everything under this prefix is called by the deployment itself, never by a
 * browser. The proxy uses it to drop external traffic before it reaches a
 * handler.
 */
export const INTERNAL_API_PATH_PREFIX = "/api/internal/";

/** Internal endpoints are never cached and never indexed. */
export const INTERNAL_API_RESPONSE_HEADERS = {
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
} as const;
