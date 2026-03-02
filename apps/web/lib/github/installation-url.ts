export function getInstallationManageUrl(
  installationId: number,
  fallbackUrl?: string | null,
): string | null {
  const appSlug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;

  if (appSlug) {
    return `https://github.com/apps/${appSlug}/installations/${installationId}`;
  }

  return fallbackUrl ?? null;
}
