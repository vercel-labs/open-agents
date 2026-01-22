import type { VercelSandbox } from "./sandbox";

/**
 * Configure git user identity on a sandbox.
 * Used after restoring from snapshot since git config isn't preserved.
 */
export async function configureGitUser(
  sandbox: VercelSandbox,
  gitUser: { name: string; email: string },
): Promise<void> {
  await sandbox.exec(
    `git config user.name "${gitUser.name}"`,
    sandbox.workingDirectory,
    10_000,
  );
  await sandbox.exec(
    `git config user.email "${gitUser.email}"`,
    sandbox.workingDirectory,
    10_000,
  );
}
