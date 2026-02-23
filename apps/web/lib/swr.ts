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
export const fetcher = async <T>(url: string): Promise<T> => {
  const res = await fetch(url);
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

/**
 * SWR revalidateOnFocus guidelines:
 *
 * - Session/auth data: revalidateOnFocus: true (detect login state changes)
 * - GitHub data (branches, repos, models): default (true) - relatively static, cheap to refetch
 * - Session diff/files: revalidateOnFocus: false - requires sandbox connection, avoid unnecessary errors
 */
