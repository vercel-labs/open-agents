"use client";

import Image from "next/image";
import { useSession } from "@/hooks/use-session";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";

export function ProfileSection() {
  const { session } = useSession();

  if (!session?.user) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>
          Your profile information is synced from GitHub.
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
