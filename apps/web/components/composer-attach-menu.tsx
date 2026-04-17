"use client";

import {
  ChevronLeft,
  ChevronRight,
  Paperclip,
  Plug,
  Plus,
  Settings2,
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

type MenuView = "main" | "mcp";

export function ComposerAttachMenu({
  sessionId,
  enabledMcpConnectionIds,
  onUploadFile,
  disabled,
}: ComposerAttachMenuProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<MenuView>("main");
  const [enabledIds, setEnabledIds] = useState<string[]>(
    enabledMcpConnectionIds,
  );
  const [saving, setSaving] = useState(false);

  const { data: connections } = useSWR<MCPConnectionSafe[]>(
    "/api/mcp/connections",
    fetcher,
  );

  useEffect(() => {
    setEnabledIds(enabledMcpConnectionIds);
  }, [enabledMcpConnectionIds]);

  // Reset to main view when popover closes
  useEffect(() => {
    if (!open) {
      const timer = setTimeout(() => setView("main"), 150);
      return () => clearTimeout(timer);
    }
  }, [open]);

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
          setEnabledIds(enabledIds);
        }
      } catch {
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
        {view === "main" ? (
          /* ── Main menu ── */
          <div>
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

            <div className="border-t border-border" />
            <button
              type="button"
              className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
              onClick={() => setView("mcp")}
            >
              <div className="flex items-center gap-2.5">
                <Plug className="size-4 text-muted-foreground" />
                <span>MCPs</span>
                {enabledCount > 0 && (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
                    {enabledCount}
                  </span>
                )}
              </div>
              <ChevronRight className="size-3.5 text-muted-foreground" />
            </button>
          </div>
        ) : (
          /* ── MCP submenu ── */
          <div>
            <button
              type="button"
              className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
              onClick={() => setView("main")}
            >
              <ChevronLeft className="size-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">
                Back
              </span>
            </button>

            {hasMcpConnections ? (
              <div className="max-h-48 overflow-y-auto py-1">
                {activeConnections?.map((conn) => (
                  <button
                    type="button"
                    key={conn.id}
                    className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-1.5 hover:bg-muted/50"
                    onClick={() =>
                      void handleToggle(conn.id, !enabledIds.includes(conn.id))
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
            ) : (
              <div className="px-3 py-3 text-center text-xs text-muted-foreground">
                No MCPs configured
              </div>
            )}

            <div className="border-t border-border px-3 py-2">
              <Link
                href="/settings/connections"
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setOpen(false)}
              >
                <Settings2 className="size-3" />
                {hasMcpConnections ? "Manage MCPs" : "Set up MCPs"}
              </Link>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
