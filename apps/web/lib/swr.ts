/**
 * Default fetcher for SWR hooks.
 * Parses JSON responses and extracts error messages from failed requests.
 */
export const fetcher = async <T>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) {
    const error = new Error("Fetch failed");
    try {
      const data = (await res.json()) as { error?: string };
      error.message = data.error ?? res.statusText;
    } catch {
      error.message = res.statusText;
    }
    throw error;
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
