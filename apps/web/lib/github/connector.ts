import { z } from "zod";

const connectorUidSchema = z.string().trim().min(1);

/**
 * Whether the Vercel Connect GitHub connector is configured. Replaces the
 * old `isGitHubAppConfigured` check (GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY).
 */
export function isGitHubConnectorConfigured(): boolean {
  return connectorUidSchema.safeParse(process.env.GITHUB_CONNECTOR).success;
}

/**
 * The Vercel Connect connector UID (e.g. `github/open-agents`) used for all
 * GitHub token requests.
 */
export function getGitHubConnector(): string {
  const parsed = connectorUidSchema.safeParse(process.env.GITHUB_CONNECTOR);
  if (!parsed.success) {
    throw new Error(
      "GITHUB_CONNECTOR is not configured. Create a Vercel Connect GitHub " +
        "connector (`vercel connect create github --triggers`), attach it to " +
        "this project (`vercel connect attach`), and set GITHUB_CONNECTOR to " +
        "its UID (e.g. github/open-agents).",
    );
  }
  return parsed.data;
}

/**
 * The GitHub App backing the connector is not installed for the requested
 * installation (org/user). Maps to the existing `no_installation` UX.
 */
export class GitHubInstallationMissingError extends Error {
  constructor(message = "GitHub App installation not found") {
    super(message);
    this.name = "GitHubInstallationMissingError";
  }
}
