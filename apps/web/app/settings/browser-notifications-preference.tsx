"use client";

import { useState } from "react";
import { useBrowserNotifications } from "@/app/providers";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

export function BrowserNotificationsPreferenceSkeleton() {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor="browser-notifications">Browser notifications</Label>
          <p className="text-xs text-muted-foreground">
            Get a browser notification when a background chat finishes.
          </p>
        </div>
        <Switch id="browser-notifications" checked={false} disabled />
      </div>
      <div>
        <Skeleton className="h-8 w-40" />
      </div>
    </div>
  );
}

export function BrowserNotificationsPreference() {
  const {
    enabled: browserNotificationsEnabled,
    isSupported: browserNotificationsSupported,
    permission: browserNotificationPermission,
    requestPermission: requestBrowserNotificationPermission,
    setEnabled: setBrowserNotificationsEnabled,
    showNotification,
  } = useBrowserNotifications();
  const [isUpdatingBrowserNotifications, setIsUpdatingBrowserNotifications] =
    useState(false);

  const handleBrowserNotificationsChange = async (nextEnabled: boolean) => {
    if (!browserNotificationsSupported) {
      return;
    }

    if (!nextEnabled) {
      setBrowserNotificationsEnabled(false);
      return;
    }

    setIsUpdatingBrowserNotifications(true);
    try {
      const nextPermission =
        browserNotificationPermission === "granted"
          ? "granted"
          : await requestBrowserNotificationPermission();

      setBrowserNotificationsEnabled(nextPermission === "granted");
    } finally {
      setIsUpdatingBrowserNotifications(false);
    }
  };

  const handleSendTestNotification = () => {
    showNotification({
      title: "Open Harness test notification",
      body: "Browser notifications are working in this browser.",
      tag: "open-harness-test-notification",
      url:
        typeof window === "undefined"
          ? undefined
          : `${window.location.pathname}${window.location.search}`,
    });
  };

  const canSendTestNotification =
    browserNotificationsEnabled && browserNotificationPermission === "granted";
  const browserNotificationDescription = !browserNotificationsSupported
    ? "Desktop notifications are not supported in this browser."
    : browserNotificationPermission === "denied"
      ? "Desktop notifications are blocked for this site. Update your browser site settings to enable them. The completion sound can still play even when browser notifications are blocked."
      : canSendTestNotification
        ? "You'll get a browser notification when a background chat finishes. Use the test button below to verify your browser and OS notification settings."
        : "Get a browser notification when a background chat finishes. The browser will ask for permission the first time you enable it. The completion sound is separate and can still play without a browser notification.";

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor="browser-notifications">Browser notifications</Label>
          <p className="text-xs text-muted-foreground">
            {browserNotificationDescription}
          </p>
        </div>
        <Switch
          id="browser-notifications"
          checked={
            browserNotificationsEnabled &&
            browserNotificationPermission === "granted"
          }
          onCheckedChange={handleBrowserNotificationsChange}
          disabled={
            isUpdatingBrowserNotifications || !browserNotificationsSupported
          }
        />
      </div>
      {canSendTestNotification ? (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleSendTestNotification}
          >
            Send test notification
          </Button>
        </div>
      ) : null}
    </div>
  );
}
