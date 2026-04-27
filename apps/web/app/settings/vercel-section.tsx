"use client";

import { useSession } from "@/hooks/use-session";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Lock } from "lucide-react";

function VercelIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 76 65"
      fill="currentColor"
    >
      <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
    </svg>
  );
}

export function VercelSectionSkeleton() {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/10">
      <div className="border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <VercelIcon className="h-4 w-4" />
          <span className="text-sm font-medium">Vercel</span>
        </div>
        <Skeleton className="mt-2 h-3.5 w-40" />
      </div>
      <div className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-full" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      </div>
    </div>
  );
}

export function VercelSection() {
  const { session, loading } = useSession();

  if (loading) {
    return <VercelSectionSkeleton />;
  }

  const user = session?.user;
  if (!user) {
    return null;
  }

  return (
    <div className="rounded-lg border border-border/50 bg-muted/10">
      <div className="border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <VercelIcon className="h-4 w-4" />
          <span className="text-sm font-medium">Vercel</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Login is managed by Vercel
        </p>
      </div>

      <div className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="size-9 rounded-full">
              <AvatarImage src={user.avatar} alt={user.username} />
              <AvatarFallback className="rounded-full">
                {user.username?.charAt(0).toUpperCase() ?? "?"}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {user.name || user.username}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {user.username}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3" />
            <span>Managed</span>
          </div>
        </div>
      </div>
    </div>
  );
}
