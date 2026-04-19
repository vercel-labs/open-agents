"use client";

import Link from "next/link";
import type { VercelConnectionReason } from "@/lib/vercel/connection-status";
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
  reason: VercelConnectionReason | null,
): string {
  switch (reason) {
    case "token_unavailable":
      return "Your saved Vercel token is no longer usable.";
    case "userinfo_auth_failed":
      return "Vercel rejected the saved session while we validated your connection.";
    default:
      return "Your Vercel connection needs to be refreshed before you continue.";
  }
}

export function VercelReconnectDialog({
  open,
  reconnectUrl,
  reason,
  onSignOut,
}: {
  open: boolean;
  reconnectUrl: string;
  reason: VercelConnectionReason | null;
  onSignOut: () => void;
}) {
  return (
    <Dialog open={open}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Reconnect Vercel</DialogTitle>
          <DialogDescription>
            {getReconnectDescription(reason)} Reconnect now to keep using the
            app.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onSignOut}>
            Sign out
          </Button>
          <Button asChild>
            <Link href={reconnectUrl}>Reconnect Vercel</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
