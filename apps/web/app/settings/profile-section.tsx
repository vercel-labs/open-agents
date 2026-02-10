"use client";

import Image from "next/image";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/hooks/use-session";

export function ProfileSectionSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>
          Your profile information is synced from Vercel.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>

        <div className="grid gap-4 pt-4">
          <div className="grid gap-2">
            <Label>Username</Label>
            <Skeleton className="h-5 w-32" />
          </div>
          <div className="grid gap-2">
            <Label>Email</Label>
            <Skeleton className="h-5 w-40" />
          </div>
          <div className="grid gap-2">
            <Label>Name</Label>
            <Skeleton className="h-5 w-36" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ProfileSection() {
  const { session, loading } = useSession();

  if (loading) {
    return <ProfileSectionSkeleton />;
  }

  if (!session?.user) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>
          Your profile information is synced from Vercel.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          {session.user.avatar && (
            <Image
              src={session.user.avatar}
              alt={session.user.username}
              width={64}
              height={64}
              className="rounded-full"
            />
          )}
          <div>
            <p className="font-medium">
              {session.user.name ?? session.user.username}
            </p>
            <p className="text-sm text-muted-foreground">
              @{session.user.username}
            </p>
          </div>
        </div>

        <div className="grid gap-4 pt-4">
          <div className="grid gap-2">
            <Label>Username</Label>
            <p className="text-sm text-muted-foreground">
              {session.user.username}
            </p>
          </div>

          {session.user.email && (
            <div className="grid gap-2">
              <Label>Email</Label>
              <p className="text-sm text-muted-foreground">
                {session.user.email}
              </p>
            </div>
          )}

          {session.user.name && (
            <div className="grid gap-2">
              <Label>Name</Label>
              <p className="text-sm text-muted-foreground">
                {session.user.name}
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
