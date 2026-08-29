/**
 * Constants shared by every layer that fronts an internal, server-to-server
 * endpoint: the route handler that authenticates calls, the workflow-side
 * client that signs them, and the proxy that pre-filters external traffic.
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

/**
 * The single answer every layer gives to a request for an internal endpoint it
 * cannot authenticate — no signature, bad signature, oversized body. `404`
 * rather than `401` because an unauthenticated caller is owed no detail, not
 * because the endpoint is a secret: a verb the route does not implement still
 * gets Next's own `405`. Shared so the route handler's answer to an
 * unauthenticated call matches the proxy's.
 */
export const INTERNAL_API_REJECTED_STATUS = 404;

/** Internal endpoints are never cached. */
export const INTERNAL_API_RESPONSE_HEADERS = {
  "cache-control": "no-store",
} as const;
