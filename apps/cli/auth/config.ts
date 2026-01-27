/**
 * Configuration for CLI authentication with the web app
 */

// Production URL for the web app
const PRODUCTION_URL = "https://app.openharness.dev";

// Development URL (local)
const DEVELOPMENT_URL = "http://localhost:3000";

/**
 * Get the web app URL for authentication
 * Priority:
 * 1. OPEN_HARNESS_URL environment variable
 * 2. Development URL if NODE_ENV is "development"
 * 3. Production URL otherwise
 */
export function getWebAppUrl(): string {
  if (process.env.OPEN_HARNESS_URL) {
    return process.env.OPEN_HARNESS_URL;
  }

  const isDev = process.env.NODE_ENV === "development";
  return isDev ? DEVELOPMENT_URL : PRODUCTION_URL;
}

/**
 * Get the API base URL for CLI auth endpoints
 */
export function getApiUrl(path: string): string {
  const baseUrl = getWebAppUrl();
  return `${baseUrl}${path}`;
}
