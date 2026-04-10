"use client";

import Link from "next/link";
import type { GitHubConnectionReason } from "@/lib/github/connection-status";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function getReconnectDescription(
  reason: GitHubConnectionReason | null,
): string {
  switch (reason) {
    case "installations_missing":
      return "GitHub no longer reports your app installation. This usually happens after app permission changes or an installation being invalidated.";
    case "sync_auth_failed":
      return "GitHub rejected the saved connection while we refreshed your installation access.";
    case "token_unavailable":
      return "Your saved GitHub token is no longer usable.";
    default:
      return "Your GitHub connection needs to be refreshed before you continue.";
  }
}

export function GitHubReconnectDialog({
  open,
  reconnectUrl,
  reason,
}: {
  open: boolean;
  reconnectUrl: string;
  reason: GitHubConnectionReason | null;
}) {
  return (
    <Dialog open={open}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Reconnect GitHub</DialogTitle>
          <DialogDescription>
            {getReconnectDescription(reason)} Reconnect now to restore
            repository access and keep using the app.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button asChild>
            <Link href={reconnectUrl}>Reconnect GitHub</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
