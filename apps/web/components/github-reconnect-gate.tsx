"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useGitHubConnectionStatus } from "@/hooks/use-github-connection-status";
import { useSession } from "@/hooks/use-session";
import { GitHubReconnectDialog } from "./github-reconnect-dialog";

export function GitHubReconnectGate() {
  const pathname = usePathname();
  const router = useRouter();
  const {
    accessDeniedRedirect,
    isAuthenticated,
    loading,
    managedTemplateAccessDenied,
  } = useSession();
  const redirectPath = accessDeniedRedirect ?? "/deploy-your-own";
  const { reconnectRequired, reason, isLoading } = useGitHubConnectionStatus({
    enabled: isAuthenticated && !managedTemplateAccessDenied,
  });

  useEffect(() => {
    if (managedTemplateAccessDenied && pathname !== redirectPath) {
      router.replace(redirectPath);
    }
  }, [managedTemplateAccessDenied, pathname, redirectPath, router]);

  if (
    loading ||
    managedTemplateAccessDenied ||
    !isAuthenticated ||
    isLoading ||
    !reconnectRequired ||
    pathname === "/get-started" ||
    pathname === "/settings/connections"
  ) {
    return null;
  }

  return <GitHubReconnectDialog open reason={reason} />;
}
