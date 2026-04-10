"use client";

import {
  Paperclip,
  Plus,
  Plug,
  Settings2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { McpProviderIcon } from "@/components/mcp-icons";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { fetcher } from "@/lib/swr";

interface MCPConnectionSafe {
  id: string;
  provider: string | null;
  name: string;
  url: string;
  status: "active" | "needs_auth" | "error" | "unchecked";
  enabledByDefault: boolean;
}

interface ComposerAttachMenuProps {
  sessionId: string;
  enabledMcpConnectionIds: string[];
  onUploadFile: () => void;
  disabled?: boolean;
}

export function ComposerAttachMenu({
  sessionId,
  enabledMcpConnectionIds,
  onUploadFile,
  disabled,
}: ComposerAttachMenuProps) {
  const [open, setOpen] = useState(false);
  const [mcpExpanded, setMcpExpanded] = useState(false);
  const [enabledIds, setEnabledIds] = useState<string[]>(
    enabledMcpConnectionIds,
  );
  const [saving, setSaving] = useState(false);

  const { data: connections } = useSWR<MCPConnectionSafe[]>(
    "/api/mcp/connections",
    fetcher,
  );

  // Sync from props when they change externally
  useEffect(() => {
    setEnabledIds(enabledMcpConnectionIds);
  }, [enabledMcpConnectionIds]);

  const activeConnections = connections?.filter((c) => c.status === "active");

  const handleToggle = useCallback(
    async (connectionId: string, checked: boolean) => {
      const newIds = checked
        ? [...enabledIds, connectionId]
        : enabledIds.filter((id) => id !== connectionId);

      setEnabledIds(newIds);
      setSaving(true);

      try {
        const res = await fetch(`/api/sessions/${sessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabledMcpConnectionIds: newIds }),
        });
        if (!res.ok) {
          // Revert on failure
          setEnabledIds(enabledIds);
        }
      } catch {
        // Revert on failure
        setEnabledIds(enabledIds);
      } finally {
        setSaving(false);
      }
    },
    [enabledIds, sessionId],
  );

  const enabledCount =
    activeConnections?.filter((c) => enabledIds.includes(c.id)).length ?? 0;

  const hasMcpConnections =
    connections != null &&
    activeConnections != null &&
    activeConnections.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start" sideOffset={8}>
        {/* Upload from computer */}
        <button
          type="button"
          className="flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
          onClick={() => {
            onUploadFile();
            setOpen(false);
          }}
        >
          <Paperclip className="size-4 text-muted-foreground" />
          <span>Upload from computer</span>
        </button>

        {/* MCP section */}
        {hasMcpConnections && (
          <>
            <div className="border-t border-border" />
            <button
              type="button"
              className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
              onClick={() => setMcpExpanded(!mcpExpanded)}
            >
              <div className="flex items-center gap-2.5">
                <Plug className="size-4 text-muted-foreground" />
                <span>MCPs</span>
                {enabledCount > 0 && (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
                    {enabledCount} active
                  </span>
                )}
              </div>
              {mcpExpanded ? (
                <ChevronDown className="size-3.5 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-3.5 text-muted-foreground" />
              )}
            </button>

            {mcpExpanded && (
              <div className="border-t border-border/50">
                <div className="max-h-48 overflow-y-auto py-1">
                  {activeConnections.map((conn) => (
                    <button
                      type="button"
                      key={conn.id}
                      className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-1.5 hover:bg-muted/50"
                      onClick={() =>
                        void handleToggle(
                          conn.id,
                          !enabledIds.includes(conn.id),
                        )
                      }
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <McpProviderIcon
                          provider={conn.provider ?? "custom"}
                          className="size-4"
                        />
                        <span className="text-sm truncate">{conn.name}</span>
                      </div>
                      <Switch
                        checked={enabledIds.includes(conn.id)}
                        onCheckedChange={(checked) =>
                          void handleToggle(conn.id, checked)
                        }
                        disabled={saving}
                        className="scale-75"
                      />
                    </button>
                  ))}
                </div>
                <div className="border-t border-border px-3 py-2">
                  <Link
                    href="/settings/connections"
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setOpen(false)}
                  >
                    <Settings2 className="size-3" />
                    Manage MCPs
                  </Link>
                </div>
              </div>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
