/**
 * Error class that preserves the HTTP status code from failed fetch requests.
 * Used by the global SWR error handler to detect 401s and trigger sign-out.
 */
export class FetchError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "FetchError";
    this.status = status;
  }
}

/**
 * Default fetcher for SWR hooks.
 * Parses JSON responses and extracts error messages from failed requests.
 * Throws FetchError (with HTTP status) on non-OK responses.
 */
const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = (await res.json()) as { error?: string };
      message = data.error ?? res.statusText;
    } catch {
      // keep statusText
    }
    throw new FetchError(message, res.status);
  }
  return res.json() as Promise<T>;
};

export const fetcher = async <T>(url: string): Promise<T> => fetchJson(url);

/**
 * Use only for hydration-sensitive endpoints where a stale browser HTTP cache
 * response can overwrite fresher server-rendered state during SWR revalidation.
 */
export const fetcherNoStore = async <T>(url: string): Promise<T> =>
  fetchJson(url, { cache: "no-store" });

/**
 * SWR revalidateOnFocus guidelines:
 *
 * - Session/auth data: revalidateOnFocus: true (detect login state changes)
 * - GitHub data (branches, repos, models): default (true) - relatively static, cheap to refetch
 * - Session diff/files: revalidateOnFocus: false - requires sandbox connection, avoid unnecessary errors
 */
