export const PR_DEPLOYMENT_ACTIVE_POLL_MS = 5_000;
export const PR_DEPLOYMENT_BACKGROUND_POLL_MS = 30_000;

type GetPrDeploymentRefreshIntervalOptions = {
  hasExistingPr: boolean;
  deploymentUrl: string | null | undefined;
  documentHasFocus: boolean;
};

export function getPrDeploymentRefreshInterval({
  hasExistingPr,
  deploymentUrl,
  documentHasFocus,
}: GetPrDeploymentRefreshIntervalOptions): number {
  if (!hasExistingPr || deploymentUrl) {
    return 0;
  }

  return documentHasFocus
    ? PR_DEPLOYMENT_ACTIVE_POLL_MS
    : PR_DEPLOYMENT_BACKGROUND_POLL_MS;
}
