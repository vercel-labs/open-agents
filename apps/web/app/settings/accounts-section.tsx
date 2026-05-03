"use client";

import {
  AlertCircle,
  Ban,
  ChevronDown,
  ArrowUpRight,
  ExternalLink,
  Globe,
  ListFilter,
  Loader2,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useGitHubConnectionStatus } from "@/hooks/use-github-connection-status";
import { useSession } from "@/hooks/use-session";
import { unlinkGitHub } from "@/lib/github/actions/connection";
import { authClient } from "@/lib/auth/client";
import type { GitHubConnectionReason } from "@/lib/github/status";
import { fetcher } from "@/lib/swr";

const GITHUB_OAUTH_CALLBACK =
  "/api/github/post-link?next=/settings/connections";

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

function startGitHubInstallForOrg(githubId: number) {
  const params = new URLSearchParams({
    next: "/settings/connections",
    target_id: String(githubId),
  });

  window.location.href = `/api/github/app/install?${params.toString()}`;
}

function startGitHubInstallFromSettings() {
  const params = new URLSearchParams({
    next: "/settings/connections",
  });
  window.location.href = `/api/github/app/install?${params.toString()}`;
}

async function startGitHubReconnect(reason: GitHubConnectionReason | null) {
  if (reason === "installations_missing") {
    const params = new URLSearchParams({
      next: "/settings/connections",
      reconnect: "1",
    });
    window.location.href = `/api/github/app/install?${params.toString()}`;
    return;
  }

  await authClient.linkSocial({
    provider: "github",
    callbackURL: GITHUB_OAUTH_CALLBACK,
  });
}

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
      case "account_connected":
        toast.success("GitHub account connected");
        break;
      case "app_installed":
        toast.success("GitHub App installed", {
          description:
            "Repository access is now configured for the selected account.",
        });
        break;
      case "link_failed":
        toast.error("Failed to connect GitHub account", {
          description: "Please try again.",
        });
        break;
      case "request_sent":
        toast.info("Installation request sent", {
          description: "An admin needs to approve the installation.",
        });
        break;
      case "no_action":
        toast.info("No changes made", {
          description: "You returned from GitHub without installing the app.",
        });
        break;
      case "pending_sync":
        if (missingInstallation === "1") {
          toast.info("No new installation detected", {
            description:
              "The app may already be installed. Check the list below.",
          });
        } else {
          toast.info("Installation pending", {
            description: "It may take a moment to sync.",
          });
        }
        break;
      case "app_not_configured":
        toast.error("GitHub App not configured", {
          description: "Contact the administrator.",
        });
        break;
      case "trial_blocked":
        toast.error("GitHub connections are disabled", {
          description:
            "Hosted trial accounts can start chats without connecting GitHub.",
        });
        break;
      case "invalid_state":
        toast.error("Callback expired", {
          description: "Please start the installation again.",
        });
        break;
      default:
        break;
    }
  }, [searchParams]);
}

export function AccountsSectionSkeleton() {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/10">
      <div className="border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <GitHubIcon className="h-5 w-5" />
          <span className="text-sm font-medium">GitHub</span>
        </div>
        <Skeleton className="mt-2 h-3.5 w-64" />
      </div>
      <div className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
        <Skeleton className="h-4 w-48" />
      </div>
    </div>
  );
}

function InstallBadge({
  status,
  repositorySelection,
  className = "size-4",
}: {
  status: "installed" | "not_installed";
  repositorySelection: "all" | "selected" | null;
  className?: string;
}) {
  if (status === "installed" && repositorySelection === "all") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Globe
            className={`${className} shrink-0 text-green-600 dark:text-green-400`}
          />
        </TooltipTrigger>
        <TooltipContent>All Repositories</TooltipContent>
      </Tooltip>
    );
  }
  if (status === "installed") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <ListFilter
            className={`${className} shrink-0 text-amber-600 dark:text-amber-400`}
          />
        </TooltipTrigger>
        <TooltipContent>Select Repositories</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Ban
          className={`${className} shrink-0 text-red-600 dark:text-red-400`}
        />
      </TooltipTrigger>
      <TooltipContent>No Repository Access</TooltipContent>
    </Tooltip>
  );
}

function OrgRow({
  org,
  connectionDisabled,
}: {
  org: OrgInstallStatus;
  connectionDisabled: boolean;
}) {
  const isInstalled = org.installStatus === "installed";
  const avatarSrc =
    org.avatarUrl ||
    `https://avatars.githubusercontent.com/${org.login}?s=40&v=4`;

  if (!isInstalled) {
    return (
      <div className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="size-6 rounded-full text-[9px]">
            <AvatarImage src={avatarSrc} alt={org.login} />
            <AvatarFallback className="rounded-full text-[9px]">
              {org.login.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium">{org.login}</span>
            <InstallBadge
              status={org.installStatus}
              repositorySelection={org.repositorySelection}
              className="size-3"
            />
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          disabled={connectionDisabled}
          onClick={() => startGitHubInstallForOrg(org.githubId)}
        >
          Install
        </Button>
      </div>
    );
  }

  return (
    <Link
      href={org.installationUrl ?? "#"}
      target="_blank"
      rel="noreferrer"
      className="group flex w-full items-center gap-3 rounded-md -mx-2 px-2 py-2 first:mt-0 last:mb-0 transition-colors hover:bg-muted/40"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <Avatar className="size-5 rounded-full text-[8px]">
          <AvatarImage src={avatarSrc} alt={org.login} />
          <AvatarFallback className="rounded-full text-[8px]">
            {org.login.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs font-medium">{org.login}</span>
          <InstallBadge
            status={org.installStatus}
            repositorySelection={org.repositorySelection}
            className="size-3"
          />
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1 font-mono text-[11px] text-muted-foreground/0 transition-all group-hover:text-muted-foreground">
        <span>Configure</span>
        <ExternalLink className="size-3" />
      </div>
    </Link>
  );
}

/**
 * Connection status dropdown button:
 * • Connected  → green dot, dropdown: manage on github, re-authenticate, disconnect
 * • Reconnect  → amber dot, dropdown: re-authenticate, disconnect
 * • Not connected → plain "Connect" button, no dropdown
 */
function ConnectionStatusButton({
  status,
  onReconnect,
  onDisconnect,
  unlinking,
  connectionDisabled,
}: {
  status: "connected" | "reconnect" | "not_connected";
  configureUrl?: string | null;
  onReconnect?: () => void;
  onDisconnect: () => void;
  unlinking: boolean;
  connectionDisabled: boolean;
}) {
  if (status === "not_connected") {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1 text-xs"
        disabled={connectionDisabled}
        onClick={startGitHubInstallFromSettings}
      >
        Connect
        <ArrowUpRight className="size-3" />
      </Button>
    );
  }

  const isConnected = status === "connected";
  const dotColor = isConnected ? "bg-green-500" : "bg-amber-500";
  const label = isConnected ? "Connected" : "Reconnect";
  const clientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
  const manageUrl = clientId
    ? `https://github.com/settings/connections/applications/${clientId}`
    : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-2 text-xs">
          <span className={`size-2 rounded-full ${dotColor}`} />
          {label}
          <ChevronDown className="size-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {isConnected && manageUrl ? (
          <DropdownMenuItem asChild>
            <Link
              href={manageUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between"
            >
              Manage on GitHub
              <ExternalLink className="size-3.5 text-muted-foreground" />
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={onReconnect} disabled={connectionDisabled}>
          Re-authenticate
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onClick={onDisconnect}
          disabled={unlinking}
        >
          {unlinking ? <Loader2 className="size-4 animate-spin" /> : null}
          Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AccountsSection() {
  const { hasGitHubAccount, hasGitHub, loading, session } = useSession();
  const isTrialUser = session?.isManagedTemplateTrialUser ?? false;
  const { mutate } = useSWRConfig();
  const [unlinking, setUnlinking] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const {
    reconnectRequired,
    reason,
    isLoading: connectionStatusLoading,
    refresh: refreshConnectionStatus,
  } = useGitHubConnectionStatus({ enabled: hasGitHub });

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

  const handleRefresh = useCallback(async () => {
    await Promise.all([mutateConnection(), refreshConnectionStatus()]);
  }, [mutateConnection, refreshConnectionStatus]);

  async function handleUnlink() {
    setUnlinking(true);
    try {
      const result = await unlinkGitHub();
      if (result.success) {
        await mutate("/api/auth/info");
        await Promise.all([mutateConnection(), refreshConnectionStatus()]);
        toast.success("GitHub disconnected");
      } else {
        toast.error(result.error ?? "Failed to disconnect GitHub");
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

  const requiresReconnect = hasGitHub && (reconnectRequired || tokenExpired);

  // show disconnected state when reconnect is needed but we have no usable profile
  const showDisconnected =
    reconnectRequired && (!connectionData || !connectionData.user.login);

  return (
    <div className="rounded-lg border border-border/50 bg-muted/10">
      {/* Header */}
      <div className="border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <GitHubIcon className="h-5 w-5" />
          <span className="text-sm font-medium">GitHub</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Connect GitHub to create commits, open pull requests, and manage your
          repositories
        </p>
      </div>

      {/* Body */}
      <div className="space-y-4 p-4">
        {!hasGitHub ? (
          <NotConnectedState connectionDisabled={isTrialUser} />
        ) : (connectionLoading || connectionStatusLoading || !connectionData) &&
          !connectionError ? (
          <ConnectionLoadingSkeleton />
        ) : showDisconnected ? (
          <DisconnectedState
            reconnectReason={reason}
            onDisconnect={() => setDisconnectOpen(true)}
            unlinking={unlinking}
            connectionDisabled={isTrialUser}
          />
        ) : connectionError && !connectionData ? (
          <ConnectionErrorState onRetry={handleRefresh} />
        ) : connectionData ? (
          <ConnectedState
            data={connectionData}
            reconnectRequired={requiresReconnect}
            reconnectReason={reason}
            onDisconnect={() => setDisconnectOpen(true)}
            unlinking={unlinking}
            connectionDisabled={isTrialUser}
          />
        ) : (
          <NotConnectedState connectionDisabled={isTrialUser} />
        )}
      </div>

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
                handleUnlink();
              }}
            >
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NotConnectedState({
  connectionDisabled,
}: {
  connectionDisabled: boolean;
}) {
  const [isLinking, setIsLinking] = useState(false);

  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-muted-foreground">
        {connectionDisabled
          ? "GitHub connections are disabled for hosted trial accounts"
          : "No GitHub account connected"}
      </p>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0 gap-1"
        disabled={isLinking || connectionDisabled}
        onClick={async () => {
          if (connectionDisabled) return;

          setIsLinking(true);
          await authClient.linkSocial({
            provider: "github",
            callbackURL: GITHUB_OAUTH_CALLBACK,
          });
        }}
      >
        Connect
        {isLinking ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <ArrowUpRight className="size-3" />
        )}
      </Button>
    </div>
  );
}

function DisconnectedState({
  reconnectReason,
  onDisconnect,
  unlinking,
  connectionDisabled,
}: {
  reconnectReason: GitHubConnectionReason | null;
  onDisconnect: () => void;
  unlinking: boolean;
  connectionDisabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <AlertCircle className="size-4 shrink-0 text-amber-500" />
        <span>Your GitHub connection has been disconnected.</span>
      </div>
      <ConnectionStatusButton
        status="reconnect"
        onReconnect={() => void startGitHubReconnect(reconnectReason)}
        onDisconnect={onDisconnect}
        unlinking={unlinking}
        connectionDisabled={connectionDisabled}
      />
    </div>
  );
}

function ConnectionErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <AlertCircle className="size-4 shrink-0 text-destructive" />
        <span>Failed to load GitHub connection info.</span>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={onRetry}
      >
        Retry
      </Button>
    </div>
  );
}

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

function ConnectedState({
  data,
  reconnectRequired,
  reconnectReason,
  onDisconnect,
  unlinking,
  connectionDisabled,
}: {
  data: ConnectionStatusResponse;
  reconnectRequired: boolean;
  reconnectReason: GitHubConnectionReason | null;
  onDisconnect: () => void;
  unlinking: boolean;
  connectionDisabled: boolean;
}) {
  const [orgsExpanded, setOrgsExpanded] = useState(false);

  // combine personal account + orgs into a single list
  const allAccounts: OrgInstallStatus[] = [
    {
      githubId: data.user.githubId,
      login: data.user.login,
      avatarUrl: data.user.avatarUrl,
      installStatus: data.personalInstallStatus,
      installationId: null,
      installationUrl: data.personalInstallationUrl,
      repositorySelection: data.personalRepositorySelection,
    },
    ...data.orgs,
  ];
  const installedCount = allAccounts.filter(
    (a) => a.installStatus === "installed",
  ).length;

  return (
    <>
      {/* User info row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="size-9 rounded-full">
            <AvatarImage src={data.user.avatarUrl} alt={data.user.login} />
            <AvatarFallback className="rounded-full">
              {data.user.login.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{data.user.login}</p>
            {reconnectRequired ? (
              <p className="inline-flex items-center gap-1 text-xs text-amber-500">
                <AlertCircle className="size-3" />
                Your GitHub connection has been disconnected.
              </p>
            ) : null}
          </div>
        </div>

        <ConnectionStatusButton
          status={reconnectRequired ? "reconnect" : "connected"}
          onReconnect={() => void startGitHubReconnect(reconnectReason)}
          onDisconnect={onDisconnect}
          unlinking={unlinking}
          connectionDisabled={connectionDisabled}
        />
      </div>

      {/* Accounts list */}
      {!reconnectRequired && allAccounts.length > 0 ? (
        <div className="-mx-4 border-t border-border/50 px-4 pt-3">
          <button
            type="button"
            onClick={() => setOrgsExpanded((prev) => !prev)}
            className="flex w-full items-center justify-between py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <span>
              Installed in {installedCount}/{allAccounts.length} account
              {allAccounts.length !== 1 ? "s" : ""}
            </span>
            <ChevronDown
              className={`size-3.5 transition-transform ${orgsExpanded ? "rotate-180" : ""}`}
            />
          </button>

          {orgsExpanded ? (
            <div className="mt-2 space-y-0 divide-y divide-border/30">
              {allAccounts.map((org) => (
                <OrgRow
                  key={org.login}
                  org={org}
                  connectionDisabled={connectionDisabled}
                />
              ))}

              <div className="flex items-center py-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px] text-muted-foreground"
                  disabled={connectionDisabled}
                  onClick={startGitHubInstallFromSettings}
                >
                  <Plus className="size-3.5" />
                  Add GitHub account
                </Button>
              </div>

              <div className="pt-2.5">
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-muted-foreground">
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                  <div>
                    <p className="font-medium text-foreground">
                      Missing an account?
                    </p>
                    <p className="mt-0.5">
                      You may not have membership, or the account restricts
                      third-party access. Ask an admin to install the GitHub App
                      from the account&apos;s settings page on GitHub.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
