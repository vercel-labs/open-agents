/**
 * GitHub integration barrel exports.
 *
 * Organizes the GitHub lib modules under a single entry point with
 * clear categories for discovery and IDE auto-imports.
 */

// ---------------------------------------------------------------------------
// Authentication & Tokens
// ---------------------------------------------------------------------------

/** GitHub App authentication (JWT-based, for server-to-server calls). */
export {
  getInstallationOctokit,
  getInstallationToken,
  isGitHubAppConfigured,
  getAppCoAuthorTrailer,
  getAppOctokit,
} from "./app-auth";

/** User OAuth token management with auto-refresh. */
export { getUserGitHubToken } from "./user-token";

/** Build authenticated raw-content URLs. */
export { createAuthenticatedRepoUrl } from "./auth-url";

// ---------------------------------------------------------------------------
// Connection Status
// ---------------------------------------------------------------------------

export type {
  GitHubConnectionStatus,
  GitHubConnectionReason,
  GitHubConnectionStatusResponse,
} from "./connection-status";
export { buildGitHubReconnectUrl } from "./connection-status";

// ---------------------------------------------------------------------------
// GitHub App Installations
// ---------------------------------------------------------------------------

/** Sync a user's GitHub App installations to the database. */
export { syncUserInstallations } from "./installations-sync";

/** Build the GitHub App installation/configuration URL. */
export { getInstallationManageUrl } from "./installation-url";

/** List repositories accessible through a specific installation. */
export type { InstallationRepository } from "./installation-repos";
export { listUserInstallationRepositories } from "./installation-repos";

// ---------------------------------------------------------------------------
// REST API Helpers
// ---------------------------------------------------------------------------

/** Low-level GitHub REST API helpers (user info, orgs, branches). */
export { fetchGitHubUser, fetchGitHubOrgs, fetchGitHubBranches } from "./api";

// ---------------------------------------------------------------------------
// Octokit Client (PR, Repo, Deployment operations)
// ---------------------------------------------------------------------------

export type {
  PullRequestMergeMethod,
  PullRequestCheckState,
  PullRequestCheckRun,
  PullRequestMergeReadiness,
} from "./client";

export {
  getOctokit,
  createPullRequest,
  closePullRequest,
  mergePullRequest,
  enablePullRequestAutoMerge,
  getPullRequestMergeReadiness,
  createRepository,
  deleteBranchRef,
  findLatestVercelDeploymentUrlForPullRequest,
  findPullRequestByBranch,
  getPullRequestStatus,
  parseGitHubUrl,
} from "./client";

// ---------------------------------------------------------------------------
// Repository Utilities
// ---------------------------------------------------------------------------

export {
  isValidGitHubRepoOwner,
  isValidGitHubRepoName,
  buildGitHubAuthRemoteUrl,
} from "./repo-identifiers";
