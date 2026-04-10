"use client";

import {
  AlertCircle,
  Building2,
  CheckCircle2,
  ChevronDown,
  Circle,
  ExternalLink,
  Loader2,
  RefreshCw,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/hooks/use-session";
import { fetcher } from "@/lib/swr";

// ── Types ──────────────────────────────────────────────────────────────────

interface GitHubUserProfile {
  githubId: number;
  login: string;
  avatarUrl: string;
}

interface OrgInstallStatus {
  githubId: number;
  login: string;
  avatarUrl: string;
  installStatus: "installed" | "not_installed";
  installationId: number | null;
  installationUrl: string | null;
  repositorySelection: "all" | "selected" | null;
}

interface ConnectionStatusResponse {
  user: GitHubUserProfile;
  personalInstallStatus: "installed" | "not_installed";
  personalInstallationUrl: string | null;
  personalRepositorySelection: "all" | "selected" | null;
  orgs: OrgInstallStatus[];
  tokenExpired?: boolean;
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

function startGitHubInstallFromSettings() {
  const params = new URLSearchParams({
    next: "/settings/connections",
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
    <div className="space-y-6">
      <div className="rounded-lg border border-border/50 bg-muted/10">
        <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-5 w-5 rounded" />
            <Skeleton className="h-4 w-16" />
          </div>
          <Skeleton className="h-8 w-20" />
        </div>
        <div className="p-4">
          <div className="flex items-center justify-between rounded-lg border border-border/50 p-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="space-y-1">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
            <Skeleton className="h-8 w-20" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Org row ────────────────────────────────────────────────────────────────

function OrgRow({ org }: { org: OrgInstallStatus }) {
  const isInstalled = org.installStatus === "installed";

  return (
    <div className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3 min-w-0">
        {org.avatarUrl ? (
          <Image
            src={org.avatarUrl}
            alt={org.login}
            width={28}
            height={28}
            className="h-7 w-7 rounded-full"
          />
        ) : (
          <Building2 className="h-7 w-7 text-muted-foreground p-0.5" />
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{org.login}</p>
          <p className="text-xs text-muted-foreground">
            {isInstalled ? (
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="size-3 text-green-500" />
                {org.repositorySelection === "all"
                  ? "All repositories"
                  : "Selected repositories"}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Circle className="size-3" />
                Not installed
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {isInstalled && org.installationUrl ? (
          <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
            <Link href={org.installationUrl} target="_blank" rel="noreferrer">
              Configure
              <ExternalLink className="ml-1 size-3" />
            </Link>
          </Button>
        ) : !isInstalled ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={startGitHubInstallFromSettings}
          >
            Install
          </Button>
        ) : null}
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

  const {
    data: connectionData,
    error: connectionError,
    isLoading: connectionLoading,
    mutate: mutateConnection,
  } = useSWR<ConnectionStatusResponse>(
    hasGitHubAccount ? "/api/github/orgs/install-status" : null,
    fetcher,
  );

  const tokenExpired = connectionData?.tokenExpired ?? false;

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await mutateConnection();
    } finally {
      setIsRefreshing(false);
    }
  }, [mutateConnection]);

  async function handleUnlink() {
    setUnlinking(true);
    try {
      const res = await fetch("/api/auth/github/unlink", { method: "POST" });
      if (res.ok) {
        await mutate("/api/auth/info");
        await mutateConnection();
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

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border/50 bg-muted/10">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <GitHubIcon className="h-5 w-5" />
            <span className="text-sm font-medium">GitHub</span>
          </div>
          {hasGitHub && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing || connectionLoading}
              className="h-7 w-7 p-0"
            >
              <RefreshCw
                className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`}
              />
            </Button>
          )}
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {!hasGitHub ? (
            <NotConnectedState />
          ) : connectionLoading && !connectionData ? (
            <ConnectionLoadingSkeleton />
          ) : connectionError && !connectionData ? (
            <ConnectionErrorState onRetry={handleRefresh} />
          ) : connectionData ? (
            <ConnectedState
              data={connectionData}
              tokenExpired={tokenExpired}
              unlinking={unlinking}
              onUnlink={handleUnlink}
            />
          ) : (
            <NotConnectedState />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Not connected ──────────────────────────────────────────────────────────

function NotConnectedState() {
  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-muted-foreground">
        Connect your GitHub account to access repositories.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={startGitHubInstallFromSettings}
      >
        Connect
      </Button>
    </div>
  );
}

// ── Error state ────────────────────────────────────────────────────────────

function ConnectionErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <AlertCircle className="size-4 shrink-0 text-destructive" />
        <span>Failed to load GitHub connection info.</span>
      </div>
      <Button variant="outline" size="sm" className="shrink-0" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

// ── Loading skeleton for connection data ───────────────────────────────────

function ConnectionLoadingSkeleton() {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-full" />
        <div className="space-y-1">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
      <Skeleton className="h-8 w-20" />
    </div>
  );
}

// ── Connected state ────────────────────────────────────────────────────────

function ConnectedState({
  data,
  tokenExpired,
  unlinking,
  onUnlink,
}: {
  data: ConnectionStatusResponse;
  tokenExpired: boolean;
  unlinking: boolean;
  onUnlink: () => void;
}) {
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [orgsExpanded, setOrgsExpanded] = useState(false);
  const installedOrgCount = data.orgs.filter(
    (o) => o.installStatus === "installed",
  ).length;

  return (
    <>
      {/* ── User identity ── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {data.user.avatarUrl ? (
            <Image
              src={data.user.avatarUrl}
              alt={data.user.login}
              width={36}
              height={36}
              className="h-9 w-9 rounded-full"
            />
          ) : (
            <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center">
              <GitHubIcon className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{data.user.login}</p>
            <p className="text-xs text-muted-foreground">
              {tokenExpired ? (
                <span className="inline-flex items-center gap-1 text-amber-500">
                  <AlertCircle className="size-3" />
                  Session expired
                </span>
              ) : data.personalInstallStatus === "installed" ? (
                <span className="inline-flex items-center gap-1">
                  <CheckCircle2 className="size-3 text-green-500" />
                  {data.personalRepositorySelection === "all"
                    ? "All repositories"
                    : "Selected repositories"}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Circle className="size-3" />
                  App not installed on personal account
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {tokenExpired ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={startGitHubInstallFromSettings}
            >
              Reconnect
            </Button>
          ) : (
            <>
              {data.personalInstallationUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  asChild
                >
                  <Link
                    href={data.personalInstallationUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Configure
                    <ExternalLink className="ml-1 size-3" />
                  </Link>
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDisconnectOpen(true)}
                disabled={unlinking}
                className="h-7 text-xs text-destructive hover:text-destructive"
              >
                {unlinking ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  "Disconnect"
                )}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ── Organizations accordion ── */}
      {data.orgs.length > 0 && !tokenExpired && (
        <div className="border-t border-border/50 pt-3 -mx-4 px-4">
          <button
            type="button"
            onClick={() => setOrgsExpanded((prev) => !prev)}
            className="flex w-full items-center justify-between py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>
              {data.orgs.length} organization
              {data.orgs.length !== 1 ? "s" : ""}
              {installedOrgCount > 0 && (
                <span>
                  {" "}
                  · {installedOrgCount} with app installed
                </span>
              )}
            </span>
            <ChevronDown
              className={`size-3.5 transition-transform ${orgsExpanded ? "rotate-180" : ""}`}
            />
          </button>

          {orgsExpanded && (
            <div className="mt-2 space-y-0 divide-y divide-border/30">
              {data.orgs.map((org) => (
                <OrgRow key={org.login} org={org} />
              ))}

              {/* Add organization */}
              <div className="pt-2.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={startGitHubInstallFromSettings}
                >
                  + Add an organization
                </Button>
              </div>

              {/* Guidance */}
              <div className="pt-2.5">
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-muted-foreground">
                  <AlertCircle className="size-4 mt-0.5 shrink-0 text-amber-500" />
                  <div>
                    <p className="font-medium text-foreground">
                      Missing an organization?
                    </p>
                    <p className="mt-0.5">
                      If an organization is not listed, you may not have
                      membership, or the org restricts third-party access. Ask an
                      org owner to install the GitHub App, or request access from
                      your organization&apos;s settings page on GitHub.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Disconnect confirmation dialog */}
      <Dialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Disconnect GitHub?</DialogTitle>
            <DialogDescription>
              This will unlink your GitHub account and remove all app
              installations. You can reconnect at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setDisconnectOpen(false);
                onUnlink();
              }}
            >
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
