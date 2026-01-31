/**
 * Configuration for CLI authentication with the web app
 */

import { DEFAULT_WEB_APP_URL } from "./config.generated";

// Production URL for the web app
const PRODUCTION_URL = DEFAULT_WEB_APP_URL;

/**
 * Get the web app URL for authentication
 * Priority:
 * 1. OPEN_HARNESS_URL environment variable
 * 2. OPEN_HARNESS_DEV_URL if NODE_ENV is "development"
 * 3. Production URL otherwise
 */
export function getWebAppUrl(): string {
  if (process.env.OPEN_HARNESS_URL) {
    return process.env.OPEN_HARNESS_URL;
  }

  const isDev = process.env.NODE_ENV === "development";
  if (isDev && process.env.OPEN_HARNESS_DEV_URL) {
    return process.env.OPEN_HARNESS_DEV_URL;
  }

  return PRODUCTION_URL;
}

/**
 * Get the API base URL for CLI auth endpoints
 */
export function getApiUrl(path: string): string {
  const baseUrl = getWebAppUrl();
  return `${baseUrl}${path}`;
}
