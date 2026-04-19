"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/hooks/use-session";
import { useVercelConnectionStatus } from "@/hooks/use-vercel-connection-status";
import {
  buildVercelReconnectUrl,
  VERCEL_CONNECTION_STATUS_DEDUPING_INTERVAL_MS,
} from "@/lib/vercel/connection-status";
import { VercelReconnectDialog } from "./vercel-reconnect-dialog";

const VERCEL_RECONNECT_ATTEMPT_STORAGE_KEY =
  "open-agents-vercel-reconnect-attempt";

export function VercelReconnectGate() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { session, isAuthenticated, loading } = useSession();
  const { reconnectRequired, reason, isLoading, refresh } =
    useVercelConnectionStatus({ enabled: isAuthenticated });
  const redirectingRef = useRef(false);
  const lastRouteRefreshAtRef = useRef<number | null>(null);
  const [showReconnectDialog, setShowReconnectDialog] = useState(false);

  const currentRoute = useMemo(() => {
    const search = searchParams.toString();
    return search ? `${pathname}?${search}` : pathname;
  }, [pathname, searchParams]);

  const reconnectUrl = useMemo(
    () => buildVercelReconnectUrl(currentRoute),
    [currentRoute],
  );

  useEffect(() => {
    if (!isAuthenticated || session?.authProvider !== "vercel") {
      lastRouteRefreshAtRef.current = null;
      return;
    }

    const now = Date.now();

    if (lastRouteRefreshAtRef.current === null) {
      lastRouteRefreshAtRef.current = now;
      return;
    }

    if (
      now - lastRouteRefreshAtRef.current <
      VERCEL_CONNECTION_STATUS_DEDUPING_INTERVAL_MS
    ) {
      return;
    }

    lastRouteRefreshAtRef.current = now;
    void refresh();
  }, [currentRoute, isAuthenticated, refresh, session?.authProvider]);

  useEffect(() => {
    if (loading || isLoading) {
      return;
    }

    const reconnectAttemptedUserId = window.sessionStorage.getItem(
      VERCEL_RECONNECT_ATTEMPT_STORAGE_KEY,
    );

    if (
      session?.authProvider !== "vercel" ||
      !session?.user?.id ||
      !reconnectRequired
    ) {
      window.sessionStorage.removeItem(VERCEL_RECONNECT_ATTEMPT_STORAGE_KEY);
      redirectingRef.current = false;
      setShowReconnectDialog(false);
      return;
    }

    if (redirectingRef.current) {
      return;
    }

    if (reconnectAttemptedUserId === session.user.id) {
      setShowReconnectDialog(true);
      return;
    }

    setShowReconnectDialog(false);
    window.sessionStorage.setItem(
      VERCEL_RECONNECT_ATTEMPT_STORAGE_KEY,
      session.user.id,
    );
    redirectingRef.current = true;
    window.location.assign(reconnectUrl);
  }, [isLoading, loading, reconnectRequired, reconnectUrl, session]);

  const handleSignOut = useCallback(() => {
    window.sessionStorage.removeItem(VERCEL_RECONNECT_ATTEMPT_STORAGE_KEY);

    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/api/auth/signout";
    document.body.appendChild(form);
    form.submit();
  }, []);

  if (loading || !isAuthenticated || isLoading || !reconnectRequired) {
    return null;
  }

  return (
    <VercelReconnectDialog
      open={showReconnectDialog}
      reason={reason}
      reconnectUrl={reconnectUrl}
      onSignOut={handleSignOut}
    />
  );
}
