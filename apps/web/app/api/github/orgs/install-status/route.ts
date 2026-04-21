import { NextResponse } from "next/server";
import { getInstallationsByUserId } from "@/lib/db/installations";
import { isGitHubAppConfigured } from "@/lib/github/app-auth";
import { getInstallationManageUrl } from "@/lib/github/installation-url";
import { getUserGitHubToken, hasGitHubAccount } from "@/lib/github/token";
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

export interface GitHubUserProfile {
  githubId: number;
  login: string;
  avatarUrl: string;
}

export interface OrgInstallStatus {
  githubId: number;
  login: string;
  avatarUrl: string;
  installStatus: "installed" | "not_installed";
  installationId: number | null;
  installationUrl: string | null;
  repositorySelection: "all" | "selected" | null;
}

export interface ConnectionStatusResponse {
  user: GitHubUserProfile;
  /** Whether the user's personal account has the app installed */
  personalInstallStatus: "installed" | "not_installed";
  personalInstallationUrl: string | null;
  personalRepositorySelection: "all" | "selected" | null;
  orgs: OrgInstallStatus[];
  /** True when the GitHub token is expired and the data is from the DB cache */
  tokenExpired?: boolean;
}

export async function GET() {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!isGitHubAppConfigured()) {
    return NextResponse.json(
      { error: "GitHub App not configured" },
      { status: 500 },
    );
  }

  const token = await getUserGitHubToken(session.user.id);

  // when the token is unavailable, fall back to DB-cached installations
  if (!token) {
    const linked = await hasGitHubAccount(session.user.id);
    if (!linked) {
      return NextResponse.json(
        { error: "GitHub not connected" },
        { status: 401 },
      );
    }

    const installations = await getInstallationsByUserId(session.user.id);

    // without a token we can't fetch the user profile, so build from installations
    const orgs: OrgInstallStatus[] = installations.map((i) => ({
      githubId: 0,
      login: i.accountLogin,
      avatarUrl: "",
      installStatus: "installed" as const,
      installationId: i.installationId,
      installationUrl: getInstallationManageUrl(
        i.installationId,
        i.installationUrl,
      ),
      repositorySelection: i.repositorySelection,
    }));

    const response: ConnectionStatusResponse = {
      user: {
        githubId: 0,
        login: "",
        avatarUrl: "",
      },
      personalInstallStatus: "not_installed",
      personalInstallationUrl: null,
      personalRepositorySelection: null,
      orgs,
      tokenExpired: true,
    };
    return NextResponse.json(response);
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

    if (!userResponse.ok || !orgsResponse.ok) {
      const [userBody, orgsBody] = await Promise.all([
        userResponse.ok
          ? Promise.resolve("OK")
          : userResponse.text().catch(() => "unreadable"),
        orgsResponse.ok
          ? Promise.resolve("OK")
          : orgsResponse.text().catch(() => "unreadable"),
      ]);
      console.error("GitHub API error in install-status:", {
        userId: session.user.id,
        userStatus: userResponse.status,
        userBody: userResponse.ok ? "(ok)" : userBody,
        orgsStatus: orgsResponse.status,
        orgsBody: orgsResponse.ok ? "(ok)" : orgsBody,
        tokenPresent: !!token,
      });
      return NextResponse.json(
        { error: "Failed to fetch GitHub data" },
        { status: 502 },
      );
    }

    const [githubOrgs, user] = (await Promise.all([
      orgsResponse.json(),
      userResponse.json(),
    ])) as [GitHubOrg[], GitHubUser];

    // Get all installations from DB
    const installations = await getInstallationsByUserId(session.user.id);
    const installationsByLogin = new Map(
      installations.map((i) => [i.accountLogin.toLowerCase(), i]),
    );

    // Personal account install status
    const personalInstallation = installationsByLogin.get(
      user.login.toLowerCase(),
    );

    // Build org list: merge GitHub orgs + DB installations
    const seenLogins = new Set<string>();
    const orgs: OrgInstallStatus[] = [];

    for (const org of githubOrgs) {
      const lowerLogin = org.login.toLowerCase();
      seenLogins.add(lowerLogin);
      const installation = installationsByLogin.get(lowerLogin);
      orgs.push({
        githubId: org.id,
        login: org.login,
        avatarUrl: org.avatar_url,
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

    // Add any installed orgs not in the GitHub orgs list
    for (const installation of installations) {
      const lowerLogin = installation.accountLogin.toLowerCase();
      if (
        lowerLogin === user.login.toLowerCase() ||
        seenLogins.has(lowerLogin)
      ) {
        continue;
      }
      orgs.push({
        githubId: 0,
        login: installation.accountLogin,
        avatarUrl: "",
        installStatus: "installed",
        installationId: installation.installationId,
        installationUrl: getInstallationManageUrl(
          installation.installationId,
          installation.installationUrl,
        ),
        repositorySelection: installation.repositorySelection,
      });
    }

    const response: ConnectionStatusResponse = {
      user: {
        githubId: user.id,
        login: user.login,
        avatarUrl: user.avatar_url,
      },
      personalInstallStatus: personalInstallation
        ? "installed"
        : "not_installed",
      personalInstallationUrl: personalInstallation
        ? getInstallationManageUrl(
            personalInstallation.installationId,
            personalInstallation.installationUrl,
          )
        : null,
      personalRepositorySelection:
        personalInstallation?.repositorySelection ?? null,
      orgs,
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error("Failed to fetch org install status:", error);
    return NextResponse.json(
      { error: "Failed to fetch organization data" },
      { status: 500 },
    );
  }
}
