"use client";

import { AlertTriangle, Loader2, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { useSession } from "@/hooks/use-session";
import {
  revokeAllGitHubTokens,
  revokeAllVercelTokens,
} from "@/lib/admin/actions";

function NotFoundState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="text-4xl font-bold">404</p>
      <p className="mt-2 text-sm text-muted-foreground">
        This page could not be found.
      </p>
    </div>
  );
}

function AdminPageContent() {
  const [revokeTarget, setRevokeTarget] = useState<"github" | "vercel" | null>(
    null,
  );
  const [isRevoking, setIsRevoking] = useState(false);

  async function handleRevoke() {
    if (!revokeTarget) return;
    setIsRevoking(true);

    try {
      if (revokeTarget === "github") {
        const result = await revokeAllGitHubTokens();
        if (result.success) {
          toast.success("All GitHub tokens revoked", {
            description: `Revoked ${result.revokedTokens ?? 0} tokens at GitHub, deleted ${result.deletedAccounts ?? 0} account links and ${result.deletedInstallations ?? 0} installations.`,
          });
        } else {
          toast.error(result.error ?? "Failed to revoke tokens");
        }
      } else {
        const result = await revokeAllVercelTokens();
        if (result.success) {
          toast.success("All Vercel tokens revoked", {
            description: `Revoked ${result.revokedTokens ?? 0} tokens at Vercel, deleted ${result.deletedAccounts ?? 0} account links and ${result.deletedSessions ?? 0} sessions.`,
          });
          // Sessions are now invalid — redirect to force re-login
          setTimeout(() => {
            window.location.href = "/";
          }, 1500);
        } else {
          toast.error(result.error ?? "Failed to revoke tokens");
        }
      }
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setIsRevoking(false);
      setRevokeTarget(null);
    }
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">Admin</h1>

      <div className="rounded-lg border border-red-500/30 bg-red-500/5">
        <div className="border-b border-red-500/20 px-5 py-4">
          <h2 className="text-base font-semibold text-red-400">
            Destructive Actions
          </h2>
          <p className="mt-1 text-sm text-red-400/70">
            These actions cannot be undone, proceed with caution.
          </p>
        </div>

        <div className="divide-y divide-red-500/20">
          {/* Revoke Vercel tokens */}
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <p className="text-sm text-red-400/80">
              Invalidate all user sessions by revoking all Vercel tokens.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
              onClick={() => setRevokeTarget("vercel")}
            >
              Revoke
            </Button>
          </div>

          {/* Revoke GitHub tokens */}
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <p className="text-sm text-red-400/80">
              Force all users to reconnect GitHub by revoking all GitHub tokens
              and installations.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
              onClick={() => setRevokeTarget("github")}
            >
              Revoke
            </Button>
          </div>
        </div>
      </div>

      {/* Confirmation dialog */}
      <Dialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-red-400" />
              Revoke all {revokeTarget === "github" ? "GitHub" : "Vercel"}{" "}
              tokens?
            </DialogTitle>
            <DialogDescription className="space-y-3">
              <span className="block">
                {revokeTarget === "github"
                  ? "This will delete all GitHub account links and app installations for every user. All users will need to reconnect their GitHub account."
                  : "This will delete all Vercel account links and invalidate every active session. All users — including you — will be logged out immediately."}
              </span>
              {revokeTarget === "vercel" && (
                <span className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  You will be signed out and redirected to login after this
                  action completes.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={isRevoking}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={handleRevoke}
              disabled={isRevoking}
            >
              {isRevoking ? <Loader2 className="size-4 animate-spin" /> : null}
              {isRevoking ? "Revoking…" : "Revoke all tokens"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function AdminPage() {
  const { isAdmin, loading } = useSession();

  if (loading) {
    return null;
  }

  if (!isAdmin) {
    return <NotFoundState />;
  }

  return <AdminPageContent />;
}
