import type { SWRConfiguration } from "swr";

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

export const swrConfig: SWRConfiguration = {
  fetcher,
  revalidateOnFocus: true,
  dedupingInterval: 2000,
  errorRetryCount: 3,
};
