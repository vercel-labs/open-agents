import { isIP } from "node:net";
import { getUserMCPConnections } from "@/lib/db/mcp-connections";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.internal",
  "169.254.169.254", // AWS/GCP metadata
  "100.100.100.200", // Alibaba metadata
]);

const PRIVATE_IPV4_RANGES = [
  /^127\./, // loopback
  /^10\./, // Class A private
  /^172\.(1[6-9]|2\d|3[01])\./, // Class B private
  /^192\.168\./, // Class C private
  /^0\./, // 0.0.0.0/8
  /^169\.254\./, // link-local
];

const PRIVATE_IPV6_PREFIXES = [
  "::1", // loopback
  "fc", // unique local (fc00::/7)
  "fd", // unique local
  "fe80", // link-local
  "::ffff:127.", // IPv4-mapped loopback
  "::ffff:10.", // IPv4-mapped private
  "::ffff:192.168.", // IPv4-mapped private
  "::ffff:172.", // (partial — covers 172.16-31 mapped)
  "::ffff:0.", // IPv4-mapped 0.0.0.0
  "::ffff:169.254.", // IPv4-mapped link-local
];

/**
 * Validate that a URL is safe for server-side requests (prevents SSRF).
 * Returns the validated URL string or throws an error.
 */
export function assertSafeUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`URL must use HTTPS or HTTP: ${url}`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block known metadata/internal hostnames
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error(`Blocked hostname: ${hostname}`);
  }

  // Check if hostname is an IP address
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    for (const range of PRIVATE_IPV4_RANGES) {
      if (range.test(hostname)) {
        throw new Error(`Private IPv4 address not allowed: ${hostname}`);
      }
    }
  } else if (ipVersion === 6) {
    const lower = hostname.toLowerCase();
    for (const prefix of PRIVATE_IPV6_PREFIXES) {
      if (lower.startsWith(prefix)) {
        throw new Error(`Private IPv6 address not allowed: ${hostname}`);
      }
    }
  }

  // Also check without brackets (URL API strips them for IPv6)
  if (hostname === "0.0.0.0" || hostname === "[::]" || hostname === "::") {
    throw new Error(`Blocked address: ${hostname}`);
  }

  return url;
}

/**
 * Validate a URL is HTTPS and safe for MCP connections.
 * Used for user-provided MCP server URLs.
 */
export function validateMcpUrl(
  url: string,
): { valid: true; url: string } | { valid: false; error: string } {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return { valid: false, error: "MCP server URL must use HTTPS" };
    }
    assertSafeUrl(url);
    return { valid: true, url };
  } catch (e) {
    return {
      valid: false,
      error: e instanceof Error ? e.message : "Invalid URL",
    };
  }
}

/** HTTP headers that must not be set via custom headers to prevent request smuggling */
export const BLOCKED_HEADER_NAMES = new Set([
  "host",
  "transfer-encoding",
  "content-length",
  "connection",
  "upgrade",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "expect",
  "cookie",
]);

/**
 * Filter a list of MCP connection IDs to only those owned by the given user.
 * Prevents users from attaching other users' connections to their sessions.
 */
export async function filterValidConnectionIds(
  userId: string,
  connectionIds: string[],
): Promise<string[]> {
  if (connectionIds.length === 0) return [];
  const userConnections = await getUserMCPConnections(userId);
  const owned = new Set(userConnections.map((c) => c.id));
  return connectionIds.filter((id) => owned.has(id));
}
