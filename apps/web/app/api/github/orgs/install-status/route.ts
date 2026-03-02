import { NextResponse } from "next/server";
import { getInstallationsByUserId } from "@/lib/db/installations";
import { isGitHubAppConfigured } from "@/lib/github/app-auth";
import { getInstallationManageUrl } from "@/lib/github/installation-url";
import { getUserGitHubToken } from "@/lib/github/user-token";
import { getServerSession } from "@/lib/session/get-server-session";

interface GitHubOrg {
  id: number;
  login: string;
  avatar_url: string;
}

interface GitHubUser {
  id: number;
  login: string;
  avatar_url: string;
}

export interface OrgInstallStatus {
  /** Numeric GitHub account/org ID, used for target_id in install URLs */
  githubId: number;
  login: string;
  avatarUrl: string;
  type: "User" | "Organization";
  installStatus: "installed" | "not_installed";
  installationId: number | null;
  installationUrl: string | null;
  repositorySelection: "all" | "selected" | null;
}

export async function GET() {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const token = await getUserGitHubToken();
  if (!token) {
    return NextResponse.json(
      { error: "GitHub not connected" },
      { status: 401 },
    );
  }

  if (!isGitHubAppConfigured()) {
    return NextResponse.json(
      { error: "GitHub App not configured" },
      { status: 500 },
    );
  }

  try {
    // Fetch orgs and user profile in parallel
    const [orgsResponse, userResponse] = await Promise.all([
      fetch("https://api.github.com/user/orgs?per_page=100", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      }),
      fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      }),
    ]);

    if (!orgsResponse.ok || !userResponse.ok) {
      return NextResponse.json(
        { error: "Failed to fetch GitHub data" },
        { status: 502 },
      );
    }

    const [orgs, user] = (await Promise.all([
      orgsResponse.json(),
      userResponse.json(),
    ])) as [GitHubOrg[], GitHubUser];

    // Get all installations from DB
    const installations = await getInstallationsByUserId(session.user.id);
    const installationsByLogin = new Map(
      installations.map((i) => [i.accountLogin.toLowerCase(), i]),
    );

    // Build status for the personal account
    const personalInstallation = installationsByLogin.get(
      user.login.toLowerCase(),
    );
    const results: OrgInstallStatus[] = [
      {
        githubId: user.id,
        login: user.login,
        avatarUrl: user.avatar_url,
        type: "User",
        installStatus: personalInstallation ? "installed" : "not_installed",
        installationId: personalInstallation?.installationId ?? null,
        installationUrl: personalInstallation
          ? getInstallationManageUrl(
              personalInstallation.installationId,
              personalInstallation.installationUrl,
            )
          : null,
        repositorySelection: personalInstallation?.repositorySelection ?? null,
      },
    ];

    // Build status for each org
    for (const org of orgs) {
      const installation = installationsByLogin.get(org.login.toLowerCase());
      results.push({
        githubId: org.id,
        login: org.login,
        avatarUrl: org.avatar_url,
        type: "Organization",
        installStatus: installation ? "installed" : "not_installed",
        installationId: installation?.installationId ?? null,
        installationUrl: installation
          ? getInstallationManageUrl(
              installation.installationId,
              installation.installationUrl,
            )
          : null,
        repositorySelection: installation?.repositorySelection ?? null,
      });
    }

    return NextResponse.json(results);
  } catch (error) {
    console.error("Failed to fetch org install status:", error);
    return NextResponse.json(
      { error: "Failed to fetch organization data" },
      { status: 500 },
    );
  }
}
