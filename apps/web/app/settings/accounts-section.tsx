"use client";

import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Circle,
  ExternalLink,
  Loader2,
  RefreshCw,
  User as UserIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/hooks/use-session";
import { fetcher } from "@/lib/swr";

// ── Types ──────────────────────────────────────────────────────────────────

interface OrgInstallStatus {
  githubId: number;
  login: string;
  avatarUrl: string;
  type: "User" | "Organization";
  installStatus: "installed" | "not_installed";
  installationId: number | null;
  installationUrl: string | null;
  repositorySelection: "all" | "selected" | null;
}

// ── Icons ──────────────────────────────────────────────────────────────────

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

// ── Navigation helpers ─────────────────────────────────────────────────────

function startGitHubInstallForOrg(githubId: number) {
  const params = new URLSearchParams({
    next: "/settings/accounts",
    target_id: String(githubId),
  });

  window.location.href = `/api/github/app/install?${params.toString()}`;
}

function startGitHubInstallFromSettings() {
  const params = new URLSearchParams({
    next: "/settings/accounts",
  });
  window.location.href = `/api/github/app/install?${params.toString()}`;
}

// ── Post-return toast handler ──────────────────────────────────────────────

function useGitHubReturnToast() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const githubParam = searchParams.get("github");
    const missingInstallation = searchParams.get("missing_installation_id");

    if (!githubParam) return;

    // Clean up URL params without navigation
    const url = new URL(window.location.href);
    url.searchParams.delete("github");
    url.searchParams.delete("missing_installation_id");
    window.history.replaceState({}, "", url.toString());

    switch (githubParam) {
      case "connected":
        toast.success("GitHub App installed", {
          description:
            "Repository access is now configured for the selected account.",
        });
        break;
      case "request_sent":
        toast.info("Installation request sent", {
          description:
            "An organization admin needs to approve the installation. You will gain access once approved.",
        });
        break;
      case "no_action":
        toast.info("No changes made", {
          description:
            "You returned from GitHub without installing the app. You can install it from the list below.",
        });
        break;
      case "pending_sync":
        if (missingInstallation === "1") {
          toast.info("No new installation detected", {
            description:
              "You may have returned without selecting an account, or the app is already installed. Check the list below.",
          });
        } else {
          toast.info("Installation pending", {
            description:
              "The installation could not be confirmed yet. It may take a moment to sync.",
          });
        }
        break;
      case "app_not_configured":
        toast.error("GitHub App not configured", {
          description:
            "The GitHub App is not set up on this deployment. Contact the administrator.",
        });
        break;
      case "invalid_state":
        toast.error("GitHub installation callback expired", {
          description:
            "Please start the installation again from this page to continue.",
        });
        break;
      default:
        break;
    }
  }, [searchParams]);
}

// ── Skeleton ───────────────────────────────────────────────────────────────

export function AccountsSectionSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected Accounts</CardTitle>
        <CardDescription>
          Manage GitHub App installations to grant repository access.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="space-y-1">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
          <Skeleton className="h-9 w-24" />
        </div>
      </CardContent>
    </Card>
  );
}

// ── Org row ────────────────────────────────────────────────────────────────

function OrgRow({ org }: { org: OrgInstallStatus }) {
  const isInstalled = org.installStatus === "installed";
  const isOrg = org.type === "Organization";

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="flex items-center gap-3 min-w-0">
        {/* Avatar */}
        {org.avatarUrl ? (
          <Image
            src={org.avatarUrl}
            alt={org.login}
            width={32}
            height={32}
            className="h-8 w-8 rounded-full"
          />
        ) : isOrg ? (
          <Building2 className="h-8 w-8 text-muted-foreground" />
        ) : (
          <UserIcon className="h-8 w-8 text-muted-foreground" />
        )}

        {/* Info */}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate">{org.login}</p>
            {isOrg && (
              <span className="text-[10px] text-muted-foreground border border-border rounded px-1 py-0.5 leading-none">
                org
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {isInstalled ? (
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="size-3 text-green-500" />
                Installed
                {org.repositorySelection === "all"
                  ? " - all repositories"
                  : " - selected repositories"}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Circle className="size-3 text-muted-foreground" />
                Not installed
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {isInstalled ? (
          org.installationUrl ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={org.installationUrl} target="_blank" rel="noreferrer">
                Configure
                <ExternalLink className="ml-1.5 size-3" />
              </Link>
            </Button>
          ) : null
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => startGitHubInstallForOrg(org.githubId)}
          >
            Install
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Request access guidance ────────────────────────────────────────────────

function RequestAccessGuidance() {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-muted-foreground">
      <AlertCircle className="size-4 mt-0.5 shrink-0 text-amber-500" />
      <div>
        <p className="font-medium text-foreground">Missing an organization?</p>
        <p className="mt-0.5">
          If an organization is not listed, you may not have membership, or the
          org restricts third-party access. Ask an org owner to install the
          GitHub App, or request access from your organization&apos;s settings
          page on GitHub.
        </p>
      </div>
    </div>
  );
}

// ── Main section ───────────────────────────────────────────────────────────

export function AccountsSection() {
  const { hasGitHubAccount, hasGitHub, loading } = useSession();
  const { mutate } = useSWRConfig();
  const [unlinking, setUnlinking] = useState(false);

  useGitHubReturnToast();

  // Fetch org install status only when a GitHub account is linked
  const {
    data: orgs,
    isLoading: orgsLoading,
    mutate: mutateOrgs,
  } = useSWR<OrgInstallStatus[]>(
    hasGitHubAccount ? "/api/github/orgs/install-status" : null,
    fetcher,
  );

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await mutateOrgs();
    } finally {
      setIsRefreshing(false);
    }
  }, [mutateOrgs]);

  async function handleUnlink() {
    setUnlinking(true);
    try {
      const res = await fetch("/api/auth/github/unlink", { method: "POST" });
      if (res.ok) {
        await mutate("/api/auth/info");
        toast.success("GitHub disconnected");
      }
    } catch (error) {
      console.error("Failed to unlink GitHub:", error);
      toast.error("Failed to disconnect GitHub");
    } finally {
      setUnlinking(false);
    }
  }

  if (loading) {
    return <AccountsSectionSkeleton />;
  }

  // ── State: no GitHub connected at all ──
  // Single flow: install the GitHub App, which also handles OAuth authorization
  // when "Request user authorization during installation" is enabled.
  if (!hasGitHub) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Connected Accounts</CardTitle>
          <CardDescription>
            Install the GitHub App to grant repository access. You will
            authorize and select repositories in one step on GitHub.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="flex items-center gap-3">
              <GitHubIcon className="h-8 w-8" />
              <div>
                <p className="text-sm font-medium">GitHub</p>
                <p className="text-xs text-muted-foreground">
                  Connect to access private repositories
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={startGitHubInstallFromSettings}
            >
              Connect
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── State: account linked, show org chooser ──
  const installedCount =
    orgs?.filter((o) => o.installStatus === "installed").length ?? 0;
  const totalCount = orgs?.length ?? 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>Connected Accounts</CardTitle>
            <CardDescription>
              {installedCount > 0
                ? `GitHub App installed on ${installedCount} of ${totalCount} account${totalCount !== 1 ? "s" : ""}.`
                : "Install the GitHub App on your accounts to enable repository access."}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing || orgsLoading}
            >
              <RefreshCw
                className={`size-4 ${isRefreshing ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {orgsLoading && !orgs ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="flex items-center gap-3">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="space-y-1">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                </div>
                <Skeleton className="h-8 w-20" />
              </div>
            ))}
          </div>
        ) : orgs && orgs.length > 0 ? (
          <div className="space-y-2">
            {orgs.map((org) => (
              <OrgRow key={org.login} org={org} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border p-4 text-center text-sm text-muted-foreground">
            <p>No accounts found.</p>
          </div>
        )}

        <RequestAccessGuidance />

        {/* Footer actions */}
        <div className="flex items-center justify-between pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={startGitHubInstallFromSettings}
          >
            <GitHubIcon className="mr-1.5 size-3.5" />
            Install to another account
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleUnlink}
            disabled={unlinking}
            className="text-muted-foreground"
          >
            {unlinking ? (
              <>
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                Disconnecting...
              </>
            ) : (
              "Disconnect GitHub"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
