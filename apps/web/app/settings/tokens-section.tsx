"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { InstallCommandCard } from "@/components/install-command-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { type CliToken, useCliTokens } from "@/hooks/use-cli-tokens";

function formatDate(date: Date | string | null): string {
  if (!date) return "Never";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatRelativeTime(date: Date | string | null): string {
  if (!date) return "Never";
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // Handle future dates (clock skew, etc.)
  if (diffDays < 0) return formatDate(d);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return formatDate(d);
}

interface RenameDialogProps {
  token: CliToken | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: (tokenId: string, newName: string) => Promise<void>;
}

function RenameDialog({
  token,
  open,
  onOpenChange,
  onRename,
}: RenameDialogProps) {
  const [newName, setNewName] = useState(token?.deviceName ?? "");
  const [isLoading, setIsLoading] = useState(false);

  // Reset newName when dialog opens or token changes
  useEffect(() => {
    if (open) {
      setNewName(token?.deviceName ?? "");
    }
  }, [open, token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !newName.trim()) return;

    setIsLoading(true);
    try {
      await onRename(token.id, newName.trim());
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to rename token:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename Device</DialogTitle>
          <DialogDescription>
            Change the display name for this connected client.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="device-name">Device Name</Label>
              <Input
                id="device-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="My MacBook"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!newName.trim() || isLoading}>
              {isLoading ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface RevokeDialogProps {
  token: CliToken | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRevoke: (tokenId: string) => Promise<void>;
}

function RevokeDialog({
  token,
  open,
  onOpenChange,
  onRevoke,
}: RevokeDialogProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleRevoke = async () => {
    if (!token) return;

    setIsLoading(true);
    try {
      await onRevoke(token.id);
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to revoke token:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke Access</DialogTitle>
          <DialogDescription>
            This will sign out the CLI on &quot;
            {token?.deviceName ?? "Unknown Device"}&quot;. You will need to
            re-authenticate to use it again.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleRevoke}
            disabled={isLoading}
          >
            {isLoading ? "Revoking..." : "Revoke Access"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface RevokeAllDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRevokeAll: () => Promise<void>;
  tokenCount: number;
}

function RevokeAllDialog({
  open,
  onOpenChange,
  onRevokeAll,
  tokenCount,
}: RevokeAllDialogProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleRevokeAll = async () => {
    setIsLoading(true);
    try {
      await onRevokeAll();
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to revoke all tokens:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke All Access</DialogTitle>
          <DialogDescription>
            This will sign out all {tokenCount} connected CLI clients. You will
            need to re-authenticate each device to use them again.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleRevokeAll}
            disabled={isLoading}
          >
            {isLoading ? "Revoking..." : "Revoke All"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TokensSection() {
  const { tokens, loading, renameToken, revokeToken, revokeAllTokens } =
    useCliTokens();
  const [renameDialogToken, setRenameDialogToken] = useState<CliToken | null>(
    null,
  );
  const [revokeDialogToken, setRevokeDialogToken] = useState<CliToken | null>(
    null,
  );
  const [showRevokeAllDialog, setShowRevokeAllDialog] = useState(false);

  if (loading) {
    return <TokensSectionSkeleton />;
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>Connected Clients</CardTitle>
              <CardDescription>
                CLI devices that are signed in to your account.
              </CardDescription>
            </div>
            {tokens.length > 1 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowRevokeAllDialog(true)}
              >
                Revoke All
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {tokens.length === 0 ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                No connected clients yet. Install the CLI and authenticate to
                link this device.
              </p>
              <InstallCommandCard />
            </div>
          ) : (
            <div className="space-y-4">
              {tokens.map((token) => (
                <div
                  key={token.id}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div className="space-y-1">
                    <p className="font-medium">
                      {token.deviceName ?? "Unknown Device"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Last used: {formatRelativeTime(token.lastUsedAt)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Created: {formatDate(token.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setRenameDialogToken(token)}
                    >
                      <Pencil className="h-4 w-4" />
                      <span className="sr-only">Rename</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setRevokeDialogToken(token)}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Revoke</span>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <RenameDialog
        token={renameDialogToken}
        open={!!renameDialogToken}
        onOpenChange={(open) => !open && setRenameDialogToken(null)}
        onRename={renameToken}
      />

      <RevokeDialog
        token={revokeDialogToken}
        open={!!revokeDialogToken}
        onOpenChange={(open) => !open && setRevokeDialogToken(null)}
        onRevoke={revokeToken}
      />

      <RevokeAllDialog
        open={showRevokeAllDialog}
        onOpenChange={setShowRevokeAllDialog}
        onRevokeAll={revokeAllTokens}
        tokenCount={tokens.length}
      />
    </>
  );
}

export function TokensSectionSkeleton() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>Connected Clients</CardTitle>
            <CardDescription>
              CLI devices that are signed in to your account.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" disabled>
            Revoke All
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-1">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon-sm" disabled>
              <Skeleton className="h-4 w-4" />
              <span className="sr-only">Rename</span>
            </Button>
            <Button variant="ghost" size="icon-sm" disabled>
              <Skeleton className="h-4 w-4" />
              <span className="sr-only">Revoke</span>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
