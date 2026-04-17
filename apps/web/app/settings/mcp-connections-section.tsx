"use client";

import { McpProviderIcon } from "@/components/mcp-icons";
import {
  ExternalLink,
  Loader2,
  Plus,
  Plug,
  RefreshCw,
  Trash2,
  Unplug,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetcher } from "@/lib/swr";

// ── Types ──────────────────────────────────────────────────────────────────

interface MCPConnectionSafe {
  id: string;
  provider: string | null;
  name: string;
  url: string;
  transportType: string;
  authType: AuthType;
  status: "active" | "needs_auth" | "error" | "unchecked";
  enabledByDefault: boolean;
  lastError: string | null;
  oauthScopes: string[] | null;
  createdAt: string;
  updatedAt: string;
}

type AuthType = "none" | "bearer" | "headers" | "oauth";

interface CustomHeader {
  key: string;
  value: string;
}

interface CreateCustomConnectionData {
  name: string;
  url: string;
  authType: AuthType;
  accessToken?: string;
  customHeaders?: Record<string, string>;
}

// ── Provider definitions ───────────────────────────────────────────────────

interface MCPProvider {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
}

const PREDEFINED_PROVIDERS: MCPProvider[] = [
  {
    id: "notion",
    name: "Notion",
    description: "Pages, databases, and workspace search",
    icon: <McpProviderIcon provider="notion" className="size-8" />,
  },
  {
    id: "granola",
    name: "Granola",
    description: "Meeting notes and action items",
    icon: <McpProviderIcon provider="granola" className="size-8" />,
  },
];

// ── Status dot ─────────────────────────────────────────────────────────────

function StatusDot({
  status,
  lastError,
}: {
  status: MCPConnectionSafe["status"] | "unchecked" | undefined;
  lastError?: string | null;
}) {
  let dotClass: string;
  let tooltip: string;

  switch (status) {
    case "active":
      dotClass = "bg-green-500";
      tooltip = "Connected";
      break;
    case "error":
      dotClass = "bg-red-500";
      tooltip = lastError || "Connection error";
      break;
    case "needs_auth":
      dotClass = "bg-amber-500";
      tooltip = "Authorization required";
      break;
    default:
      dotClass = "border-2 border-muted-foreground/30";
      tooltip = "Not connected";
      break;
  }

  return (
    <span
      className={`inline-block size-2 shrink-0 rounded-full ${dotClass}`}
      title={tooltip}
    />
  );
}

// ── Auth type label ────────────────────────────────────────────────────────

function AuthTypeBadge({ authType }: { authType: string }) {
  const labels: Record<string, string> = {
    none: "No auth",
    bearer: "Bearer",
    headers: "Headers",
    oauth: "OAuth",
  };
  return (
    <span className="text-[10px] text-muted-foreground border border-border rounded px-1 py-0.5 leading-none">
      {labels[authType] ?? authType}
    </span>
  );
}

// ── Post-return toast handler ──────────────────────────────────────────────

function useMcpReturnToast() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const connectedParam = searchParams.get("mcp_connected");
    const errorParam = searchParams.get("mcp_error");

    if (!connectedParam && !errorParam) return;

    // Clean up URL params without navigation
    const url = new URL(window.location.href);
    url.searchParams.delete("mcp_connected");
    url.searchParams.delete("mcp_error");
    window.history.replaceState({}, "", url.toString());

    if (connectedParam) {
      toast.success(`${capitalize(connectedParam)} MCP connected`, {
        description: "The MCP integration is now active.",
      });
    }

    if (errorParam) {
      const messages: Record<string, string> = {
        invalid_state:
          "OAuth state expired or invalid. Please try connecting again.",
        access_denied: "Access was denied during the OAuth flow.",
        server_error: "The MCP server returned an error. Please try again.",
      };
      toast.error("MCP connection failed", {
        description: messages[errorParam] ?? `Error: ${errorParam}`,
      });
    }
  }, [searchParams]);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Predefined provider card ───────────────────────────────────────────────

function ProviderCard({
  provider,
  connection,
  onConnect,
  onDisconnect,
  loading,
}: {
  provider: MCPProvider;
  connection: MCPConnectionSafe | undefined;
  onConnect: (providerId: string) => void;
  onDisconnect: (connectionId: string) => void;
  loading: boolean;
}) {
  const status = connection?.status;
  const isConnected = status === "active";

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 px-4 py-3.5">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-9 w-9 items-center justify-center">
          {provider.icon}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate">{provider.name}</p>
            <StatusDot status={status} lastError={connection?.lastError} />
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-xs text-muted-foreground truncate">
              {provider.description}
            </p>
          </div>
        </div>
      </div>
      <div className="shrink-0">
        {isConnected ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-destructive hover:text-destructive"
            onClick={() => connection && onDisconnect(connection.id)}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <>
                <Unplug className="mr-1 size-3" />
                Disconnect
              </>
            )}
          </Button>
        ) : status === "needs_auth" ? (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onConnect(provider.id)}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <>
                <ExternalLink className="mr-1 size-3" />
                Authorize
              </>
            )}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onConnect(provider.id)}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <>
                <Plug className="mr-1 size-3" />
                Connect
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Custom connection row ──────────────────────────────────────────────────

function CustomConnectionRow({
  connection,
  onAuthorize,
  onTest,
  onDelete,
  authorizing,
  testing,
  deleting,
}: {
  connection: MCPConnectionSafe;
  onAuthorize: (id: string) => void;
  onTest: (id: string) => void;
  onDelete: (id: string) => void;
  authorizing: boolean;
  testing: boolean;
  deleting: boolean;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const canAuthorize =
    connection.authType === "oauth" && connection.status !== "active";

  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 px-4 py-3.5">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/50 bg-muted/30">
            <Plug className="size-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium truncate">{connection.name}</p>
              <StatusDot
                status={connection.status}
                lastError={connection.lastError}
              />
              <AuthTypeBadge authType={connection.authType} />
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {connection.url}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {canAuthorize && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onAuthorize(connection.id)}
              disabled={authorizing}
            >
              {authorizing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <>
                  <ExternalLink className="mr-1 size-3" />
                  {connection.status === "error" ? "Retry" : "Authorize"}
                </>
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => onTest(connection.id)}
            disabled={testing || authorizing}
            title="Test connection"
          >
            {testing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
            disabled={deleting || authorizing}
            title="Delete connection"
          >
            {deleting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
          </Button>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete MCP connection?</DialogTitle>
            <DialogDescription>
              This will permanently remove &ldquo;{connection.name}&rdquo; and
              revoke any associated credentials. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setDeleteOpen(false);
                onDelete(connection.id);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Add custom MCP dialog ──────────────────────────────────────────────────

function AddCustomMcpDialog({
  open,
  onOpenChange,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateCustomConnectionData) => void;
  submitting: boolean;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [authType, setAuthType] = useState<AuthType>("none");
  const [bearerToken, setBearerToken] = useState("");
  const [customHeaders, setCustomHeaders] = useState<CustomHeader[]>([
    { key: "", value: "" },
  ]);
  const [urlError, setUrlError] = useState<string | null>(null);

  function resetForm() {
    setName("");
    setUrl("");
    setAuthType("none");
    setBearerToken("");
    setCustomHeaders([{ key: "", value: "" }]);
    setUrlError(null);
  }

  function validateUrl(value: string): boolean {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "https:") {
        setUrlError("URL must use HTTPS");
        return false;
      }
      setUrlError(null);
      return true;
    } catch {
      setUrlError("Invalid URL");
      return false;
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !url.trim()) return;
    if (!validateUrl(url)) return;

    const normalizedHeaders = Object.fromEntries(
      customHeaders
        .map((header) => [header.key.trim(), header.value.trim()] as const)
        .filter(([key, value]) => key.length > 0 && value.length > 0),
    );

    onSubmit({
      name: name.trim(),
      url: url.trim(),
      authType,
      ...(authType === "bearer" && bearerToken.trim().length > 0
        ? { accessToken: bearerToken.trim() }
        : {}),
      ...(authType === "headers" ? { customHeaders: normalizedHeaders } : {}),
    });
  }

  function addHeader() {
    setCustomHeaders((prev) => [...prev, { key: "", value: "" }]);
  }

  function removeHeader(index: number) {
    setCustomHeaders((prev) => prev.filter((_, i) => i !== index));
  }

  function updateHeader(index: number, field: "key" | "value", value: string) {
    setCustomHeaders((prev) =>
      prev.map((h, i) => (i === index ? { ...h, [field]: value } : h)),
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        if (!val) resetForm();
        onOpenChange(val);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add custom MCP</DialogTitle>
          <DialogDescription>
            Connect to a custom Model Context Protocol server.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="mcp-name">Name</Label>
            <Input
              id="mcp-name"
              placeholder="My MCP Server"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          {/* URL */}
          <div className="space-y-2">
            <Label htmlFor="mcp-url">URL</Label>
            <Input
              id="mcp-url"
              placeholder="https://mcp.example.com/sse"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (urlError) setUrlError(null);
              }}
              onBlur={() => {
                if (url.trim()) validateUrl(url);
              }}
              required
              aria-invalid={!!urlError}
            />
            {urlError && <p className="text-xs text-destructive">{urlError}</p>}
          </div>

          {/* Auth type */}
          <div className="space-y-2">
            <Label>Authentication</Label>
            <Select
              value={authType}
              onValueChange={(val) => setAuthType(val as AuthType)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="bearer">Bearer Token</SelectItem>
                <SelectItem value="headers">Custom Headers</SelectItem>
                <SelectItem value="oauth">OAuth</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Bearer token input */}
          {authType === "bearer" && (
            <div className="space-y-2">
              <Label htmlFor="mcp-token">Bearer Token</Label>
              <Input
                id="mcp-token"
                type="password"
                placeholder="Enter token"
                value={bearerToken}
                onChange={(e) => setBearerToken(e.target.value)}
                required
              />
            </div>
          )}

          {/* Custom headers inputs */}
          {authType === "headers" && (
            <div className="space-y-2">
              <Label>Headers</Label>
              <div className="space-y-2">
                {customHeaders.map((header, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      placeholder="Header name"
                      value={header.key}
                      onChange={(e) =>
                        updateHeader(index, "key", e.target.value)
                      }
                      className="flex-1"
                    />
                    <Input
                      placeholder="Value"
                      value={header.value}
                      onChange={(e) =>
                        updateHeader(index, "value", e.target.value)
                      }
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-9 w-9 p-0 shrink-0"
                      onClick={() => removeHeader(index)}
                      disabled={customHeaders.length <= 1}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addHeader}
                  className="h-7 text-xs"
                >
                  <Plus className="mr-1 size-3" />
                  Add header
                </Button>
              </div>
            </div>
          )}

          {/* OAuth explanation */}
          {authType === "oauth" && (
            <div className="flex items-start gap-2 rounded-lg border border-border/50 bg-muted/20 p-3 text-xs text-muted-foreground">
              <ExternalLink className="size-4 mt-0.5 shrink-0" />
              <p>
                After saving, you&apos;ll be redirected to the MCP server&apos;s
                OAuth consent screen to authorize access.
              </p>
            </div>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={submitting || !name.trim() || !url.trim()}
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-1 size-3 animate-spin" />
                  Creating…
                </>
              ) : (
                "Add connection"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Main section ───────────────────────────────────────────────────────────

export function McpConnectionsSection() {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [connectingProvider, setConnectingProvider] = useState<string | null>(
    null,
  );
  const [authorizingId, setAuthorizingId] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useMcpReturnToast();

  const {
    data: connections,
    isLoading,
    mutate: mutateConnections,
  } = useSWR<MCPConnectionSafe[]>("/api/mcp/connections", fetcher);

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await mutateConnections();
    } finally {
      setIsRefreshing(false);
    }
  }, [mutateConnections]);

  // Find connection for a predefined provider
  function getProviderConnection(
    providerId: string,
  ): MCPConnectionSafe | undefined {
    return connections?.find((c) => c.provider === providerId);
  }

  async function initiateOAuthConnection(body: {
    connectionId?: string;
    provider?: string;
    url?: string;
    name?: string;
  }) {
    const res = await fetch("/api/mcp/oauth/initiate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      authUrl?: string;
      error?: string;
    };

    if (!res.ok || !data.authUrl) {
      toast.error("Failed to initiate connection", {
        description: data.error ?? "An unexpected error occurred.",
      });
      return null;
    }

    return data.authUrl;
  }

  // Connect to a predefined provider via OAuth
  async function handleConnectProvider(providerId: string) {
    setConnectingProvider(providerId);
    try {
      const authUrl = await initiateOAuthConnection({ provider: providerId });
      if (!authUrl) {
        return;
      }
      window.location.href = authUrl;
    } catch (error) {
      console.error("Failed to connect provider:", error);
      toast.error("Failed to initiate connection");
    } finally {
      setConnectingProvider(null);
    }
  }

  async function handleAuthorizeConnection(connectionId: string) {
    setAuthorizingId(connectionId);
    try {
      const authUrl = await initiateOAuthConnection({ connectionId });
      if (!authUrl) {
        return;
      }
      window.location.href = authUrl;
    } catch (error) {
      console.error("Failed to authorize connection:", error);
      toast.error("Failed to initiate connection");
    } finally {
      setAuthorizingId(null);
    }
  }

  // Disconnect a provider
  async function handleDisconnect(connectionId: string) {
    setDisconnectingId(connectionId);
    try {
      const res = await fetch(`/api/mcp/connections/${connectionId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await mutateConnections();
        toast.success("MCP disconnected");
      } else {
        toast.error("Failed to disconnect");
      }
    } catch (error) {
      console.error("Failed to disconnect:", error);
      toast.error("Failed to disconnect");
    } finally {
      setDisconnectingId(null);
    }
  }

  // Create a custom MCP connection
  async function handleCreateCustom(data: CreateCustomConnectionData) {
    setSubmitting(true);
    try {
      if (data.authType === "oauth") {
        const authUrl = await initiateOAuthConnection({
          url: data.url,
          name: data.name,
        });
        if (!authUrl) {
          return;
        }
        setAddDialogOpen(false);
        window.location.href = authUrl;
        return;
      }

      const res = await fetch("/api/mcp/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        toast.error("Failed to create connection", {
          description: body.error ?? "An unexpected error occurred.",
        });
        return;
      }
      const created = (await res.json()) as MCPConnectionSafe;
      await mutateConnections();
      setAddDialogOpen(false);
      toast.success(`${created.name} MCP added`);
    } catch (error) {
      console.error("Failed to create connection:", error);
      toast.error("Failed to create connection");
    } finally {
      setSubmitting(false);
    }
  }

  // Test a custom connection
  async function handleTest(connectionId: string) {
    setTestingId(connectionId);
    try {
      const res = await fetch(`/api/mcp/connections/${connectionId}/test`, {
        method: "POST",
      });
      if (res.ok) {
        toast.success("Connection is healthy");
        await mutateConnections();
      } else {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        toast.error("Connection test failed", {
          description: data.error ?? "The server did not respond correctly.",
        });
        await mutateConnections();
      }
    } catch (error) {
      console.error("Failed to test connection:", error);
      toast.error("Connection test failed");
    } finally {
      setTestingId(null);
    }
  }

  // Delete a custom connection
  async function handleDelete(connectionId: string) {
    setDeletingId(connectionId);
    try {
      const res = await fetch(`/api/mcp/connections/${connectionId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await mutateConnections();
        toast.success("Connection deleted");
      } else {
        toast.error("Failed to delete connection");
      }
    } catch (error) {
      console.error("Failed to delete connection:", error);
      toast.error("Failed to delete connection");
    } finally {
      setDeletingId(null);
    }
  }

  // Separate predefined vs custom connections
  const customConnections =
    connections?.filter(
      (c) => !PREDEFINED_PROVIDERS.some((p) => p.id === c.provider),
    ) ?? [];

  const connectedCount =
    connections?.filter((c) => c.status === "active").length ?? 0;

  return (
    <div className="rounded-lg border border-border/50 bg-muted/10">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Plug className="h-5 w-5" />
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">MCP Connections</span>
            {connections && connections.length > 0 && (
              <span className="text-xs text-muted-foreground">
                · {connectedCount} {connectedCount === 1 ? "active" : "active"}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing || isLoading}
            className="h-7 w-7 p-0"
          >
            <RefreshCw
              className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`}
            />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddDialogOpen(true)}
            className="h-7 text-xs"
          >
            <Plus className="mr-1 size-3" />
            Add custom
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="p-4 space-y-4">
        {/* Predefined providers */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Integrations
          </p>
          <div className="space-y-2">
            {PREDEFINED_PROVIDERS.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                connection={getProviderConnection(provider.id)}
                onConnect={handleConnectProvider}
                onDisconnect={handleDisconnect}
                loading={
                  connectingProvider === provider.id ||
                  disconnectingId === getProviderConnection(provider.id)?.id
                }
              />
            ))}
          </div>
        </div>

        {/* Custom connections */}
        {(customConnections.length > 0 || isLoading) && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Custom
            </p>
            {isLoading && !connections ? (
              <div className="space-y-2">
                {[1, 2].map((i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg border border-border/50 p-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-muted animate-pulse" />
                      <div className="space-y-1">
                        <div className="h-4 w-24 rounded bg-muted animate-pulse" />
                        <div className="h-3 w-32 rounded bg-muted animate-pulse" />
                      </div>
                    </div>
                    <div className="h-8 w-20 rounded bg-muted animate-pulse" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {customConnections.map((conn) => (
                  <CustomConnectionRow
                    key={conn.id}
                    connection={conn}
                    onAuthorize={handleAuthorizeConnection}
                    onTest={handleTest}
                    onDelete={handleDelete}
                    authorizing={authorizingId === conn.id}
                    testing={testingId === conn.id}
                    deleting={deletingId === conn.id}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Empty state for custom when no predefined are connected either */}
        {!isLoading && connections && connections.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No MCP connections configured. Connect an integration above or add a
            custom MCP server.
          </p>
        )}
      </div>

      {/* Add custom MCP dialog */}
      <AddCustomMcpDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onSubmit={handleCreateCustom}
        submitting={submitting}
      />
    </div>
  );
}
