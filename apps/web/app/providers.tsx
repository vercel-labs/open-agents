"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef } from "react";
import { SWRConfig } from "swr";
import { FetchError } from "@/lib/swr";

/**
 * Global providers for the app. Wraps children in SWRConfig with a
 * global error handler that detects 401 responses and signs the user out.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const signingOut = useRef(false);

  const handleError = useCallback(
    (error: Error) => {
      if (
        error instanceof FetchError &&
        error.status === 401 &&
        !signingOut.current
      ) {
        signingOut.current = true;
        // POST to the signout endpoint to clear the session cookie,
        // then redirect to the home page.
        fetch("/api/auth/signout", { method: "POST", redirect: "manual" })
          .catch(() => {
            // If signout fails, navigate anyway so the user isn't stuck.
          })
          .finally(() => {
            signingOut.current = false;
            router.replace("/");
            router.refresh();
          });
      }
    },
    [router],
  );

  return <SWRConfig value={{ onError: handleError }}>{children}</SWRConfig>;
}
