import { z } from "zod";
import {
  deleteInstallationsNotInList,
  upsertInstallation,
} from "@/lib/db/installations";

const userInstallationSchema = z.object({
  id: z.number(),
  repository_selection: z.enum(["all", "selected"]),
  html_url: z.string().url().nullable().optional(),
  account: z.object({
    login: z.string(),
    type: z.string(),
  }),
});

const userInstallationsResponseSchema = z.object({
  installations: z.array(userInstallationSchema),
});

export class GitHubInstallationsSyncError extends Error {
  readonly status: number;
  readonly responseText: string;

  constructor(
    message: string,
    options: { status: number; responseText: string },
  ) {
    super(message);
    this.name = "GitHubInstallationsSyncError";
    this.status = options.status;
    this.responseText = options.responseText;
  }
}

const GITHUB_403_AUTH_ERROR_PATTERNS = [
  "bad credentials",
  "oauth access token has expired",
  "oauth token has expired",
  "this token has expired",
  "token is expired",
  "token is invalid",
  "token was revoked",
  "requires authentication",
  "must grant your oauth app access",
];

function isGitHubInstallations403AuthError(responseText: string): boolean {
  const normalizedResponseText = responseText.toLowerCase();

  return GITHUB_403_AUTH_ERROR_PATTERNS.some((pattern) =>
    normalizedResponseText.includes(pattern),
  );
}

export function isGitHubInstallationsAuthError(error: unknown): boolean {
  if (error instanceof GitHubInstallationsSyncError) {
    if (error.status === 401) {
      return true;
    }

    if (error.status === 403) {
      return isGitHubInstallations403AuthError(error.responseText);
    }

    return false;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const normalizedMessage = error.message.toLowerCase();

  return (
    normalizedMessage.includes(" 401 ") ||
    (normalizedMessage.includes(" 403 ") &&
      isGitHubInstallations403AuthError(normalizedMessage))
  );
}

function normalizeAccountType(type: string): "User" | "Organization" {
  return type === "Organization" ? "Organization" : "User";
}

async function fetchUserInstallations(userToken: string) {
  const installations: z.infer<typeof userInstallationSchema>[] = [];
  const perPage = 100;
  let page = 1;

  while (true) {
    const url = new URL("https://api.github.com/user/installations");
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${userToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new GitHubInstallationsSyncError(
        `Failed to fetch GitHub installations page ${page}: ${response.status} ${responseText}`,
        {
          status: response.status,
          responseText,
        },
      );
    }

    const json = await response.json();
    const parsed = userInstallationsResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(`Invalid GitHub installations response on page ${page}`);
    }

    const currentPageInstallations = parsed.data.installations;
    installations.push(...currentPageInstallations);

    if (currentPageInstallations.length < perPage) {
      break;
    }

    page += 1;
  }

  return installations;
}

export async function syncUserInstallations(
  userId: string,
  userToken: string,
): Promise<number> {
  const installations = await fetchUserInstallations(userToken);

  for (const installation of installations) {
    await upsertInstallation({
      userId,
      installationId: installation.id,
      accountLogin: installation.account.login,
      accountType: normalizeAccountType(installation.account.type),
      repositorySelection: installation.repository_selection,
      installationUrl: installation.html_url ?? null,
    });
  }

  await deleteInstallationsNotInList(
    userId,
    installations.map((installation) => installation.id),
  );

  return installations.length;
}
