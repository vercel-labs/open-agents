export const PR_DEPLOYMENT_ACTIVE_POLL_MS = 5_000;
export const PR_DEPLOYMENT_BACKGROUND_POLL_MS = 30_000;

type GetPrDeploymentRefreshIntervalOptions = {
  shouldPoll: boolean;
  deploymentUrl: string | null | undefined;
  documentHasFocus: boolean;
  waitForDeploymentUrlChangeFrom?: string | null;
};

export function getPrDeploymentRefreshInterval({
  shouldPoll,
  deploymentUrl,
  documentHasFocus,
  waitForDeploymentUrlChangeFrom,
}: GetPrDeploymentRefreshIntervalOptions): number {
  if (!shouldPoll) {
    return 0;
  }

  const shouldKeepPollingForUpdatedDeployment =
    waitForDeploymentUrlChangeFrom !== undefined &&
    (deploymentUrl ?? null) === waitForDeploymentUrlChangeFrom;

  if (deploymentUrl && !shouldKeepPollingForUpdatedDeployment) {
    return 0;
  }

  return documentHasFocus
    ? PR_DEPLOYMENT_ACTIVE_POLL_MS
    : PR_DEPLOYMENT_BACKGROUND_POLL_MS;
}
