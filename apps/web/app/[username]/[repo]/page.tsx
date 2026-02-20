import { nanoid } from "nanoid";
import { notFound, redirect } from "next/navigation";
import {
  createSessionWithInitialChat,
  getUsedSessionTitles,
} from "@/lib/db/sessions";
import { getUserPreferences } from "@/lib/db/user-preferences";
import { getRepoToken } from "@/lib/github/get-repo-token";
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
    redirect(
      `/api/auth/signin/vercel?next=${encodeURIComponent(`/${username}/${repo}`)}`,
    );
  }

  const preferencesPromise = getUserPreferences(session.user.id);

  // Get a GitHub token (if available) for private repo access
  const token = await getRepoToken(session.user.id, username)
    .then((result) => result.token)
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
  const preferences = await preferencesPromise;

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
      isNewBranch: false,
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
