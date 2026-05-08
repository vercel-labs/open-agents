const FALLBACK_BASE_URL = "https://open-agents.invalid";

export function sanitizeInternalRedirect(
  rawRedirectTo: string | null | undefined,
  fallbackPath: string,
  baseUrl = FALLBACK_BASE_URL,
): string {
  if (!rawRedirectTo || rawRedirectTo.includes("\\")) {
    return fallbackPath;
  }

  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    base = new URL(FALLBACK_BASE_URL);
  }

  let candidate: URL;
  try {
    candidate = new URL(rawRedirectTo, base);
  } catch {
    return fallbackPath;
  }

  if (candidate.origin !== base.origin) {
    return fallbackPath;
  }

  return `${candidate.pathname}${candidate.search}${candidate.hash}`;
}

export function isSafeHttpUrl(rawUrl: string): boolean {
  if (rawUrl.includes("\\")) {
    return false;
  }

  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}
