import "server-only";

const VERCEL_API_BASE_URL = "https://api.vercel.com";

export class VercelApiError extends Error {
  readonly status: number;
  readonly responseBody: string;

  constructor(message: string, status: number, responseBody: string) {
    super(message);
    this.name = "VercelApiError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

/**
 * Make an authenticated request to the Vercel REST API.
 */
export async function fetchVercelApi<T>(params: {
  method?: "GET" | "POST" | "DELETE";
  path: string;
  token: string;
  query?: URLSearchParams;
  body?: unknown;
}): Promise<T> {
  const url = new URL(`${VERCEL_API_BASE_URL}${params.path}`);
  if (params.query) {
    url.search = params.query.toString();
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${params.token}`,
    Accept: "application/json",
  };

  let bodyStr: string | undefined;
  if (params.body !== undefined) {
    headers["Content-Type"] = "application/json";
    bodyStr = JSON.stringify(params.body);
  }

  const response = await fetch(url, {
    method: params.method ?? "GET",
    headers,
    body: bodyStr,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new VercelApiError(
      `Vercel API ${params.method ?? "GET"} ${params.path} failed (${response.status})`,
      response.status,
      text,
    );
  }

  return response.json() as Promise<T>;
}

/**
 * Check if an error indicates an expired or invalid token/API key.
 */
export function isAuthenticationError(error: unknown): boolean {
  if (error instanceof VercelApiError) {
    return error.status === 401 || error.status === 403;
  }
  return false;
}
