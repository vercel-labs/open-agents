import { nanoid } from "nanoid";
import { headers as nextHeaders } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  createSessionWithInitialChat,
  getUsedSessionTitles,
} from "@/lib/db/sessions";
import { getVercelProjectLinkByRepo } from "@/lib/db/vercel-project-links";
import { getUserPreferences } from "@/lib/db/user-preferences";
import { getUserGitHubToken } from "@/lib/github/token";
import { redirectManagedTemplateUser } from "@/lib/managed-template-page-access";
import { sanitizeUserPreferencesForSession } from "@/lib/model-access";
import { getRandomCityName } from "@/lib/random-city";
import { getServerSession } from "@/lib/session/get-server-session";

interface RepoPageProps {
  params: Promise<{ username: string; repo: string }>;
}

interface GitHubRepoInfo {
  default_branch: string;
  clone_url: string;
  full_name: string;
}

async function fetchRepoInfo(
  owner: string,
  repo: string,
  token?: string,
): Promise<GitHubRepoInfo | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}`,
    { headers },
  );

  if (!response.ok) {
    console.error(
      `[repo-page] GitHub API returned ${response.status} for /repos/${owner}/${repo}`,
    );
    return null;
  }
  return response.json() as Promise<GitHubRepoInfo>;
}

export default async function RepoPage({ params }: RepoPageProps) {
  const { username, repo } = await params;

  // Auth check -- redirect to sign-in, preserving the URL for return
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }
  await redirectManagedTemplateUser(session);

  const preferencesPromise = getUserPreferences(session.user.id);
  const savedVercelProjectPromise = getVercelProjectLinkByRepo(
    session.user.id,
    username,
    repo,
  );

  // Get a GitHub token (if available) for private repo access
  const token = await getUserGitHubToken(session.user.id)
    .then((value) => value ?? undefined)
    .catch(() => {
      // No token available -- will try unauthenticated (works for public repos)
      return undefined;
    });

  // Validate the repo exists and get its default branch
  let repoInfo = await fetchRepoInfo(username, repo, token);

  // If authenticated request failed, retry without auth (public repos)
  if (!repoInfo && token) {
    repoInfo = await fetchRepoInfo(username, repo);
  }

  if (!repoInfo) {
    notFound();
  }

  // Use the user's preferred sandbox type and model
  const requestHost = (await nextHeaders()).get("host") ?? "";
  const [rawPreferences, savedVercelProject] = await Promise.all([
    preferencesPromise,
    savedVercelProjectPromise,
  ]);
  const preferences = sanitizeUserPreferencesForSession(
    rawPreferences,
    session,
    requestHost,
  );

  const cloneUrl = `https://github.com/${username}/${repo}.git`;

  const usedNames = await getUsedSessionTitles(session.user.id);
  const title = getRandomCityName(usedNames);

  const result = await createSessionWithInitialChat({
    session: {
      id: nanoid(),
      userId: session.user.id,
      title,
      status: "running",
      repoOwner: username,
      repoName: repo,
      branch: repoInfo.default_branch,
      cloneUrl,
      vercelProjectId: savedVercelProject?.projectId ?? null,
      vercelProjectName: savedVercelProject?.projectName ?? null,
      vercelTeamId: savedVercelProject?.teamId ?? null,
      vercelTeamSlug: savedVercelProject?.teamSlug ?? null,
      isNewBranch: false,
      autoCommitPushOverride: preferences.autoCommitPush,
      autoCreatePrOverride: preferences.autoCommitPush
        ? preferences.autoCreatePr
        : false,
      sandboxState: { type: preferences.defaultSandboxType },
      lifecycleState: "provisioning",
      lifecycleVersion: 0,
    },
    initialChat: {
      id: nanoid(),
      title: "New chat",
      modelId: preferences.defaultModelId,
    },
  });

  redirect(`/sessions/${result.session.id}/chats/${result.chat.id}`);
}
