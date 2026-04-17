"use client";

import { useRouter } from "next/navigation";
import {
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Toaster, toast } from "sonner";
import { SWRConfig } from "swr";
import { GitHubReconnectGate } from "@/components/github-reconnect-gate";
import { useSession } from "@/hooks/use-session";
import { FetchError } from "@/lib/swr";

const THEME_STORAGE_KEY = "open-agents-theme";
const VERCEL_RECONNECT_ATTEMPT_STORAGE_KEY =
  "open-agents-vercel-reconnect-attempt";
const DARK_MODE_MEDIA_QUERY = "(prefers-color-scheme: dark)";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") {
    return "dark";
  }

  return window.matchMedia(DARK_MODE_MEDIA_QUERY).matches ? "dark" : "light";
}

function applyTheme(resolvedTheme: ResolvedTheme) {
  document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
}

/**
 * Global providers for the app. Wraps children in SWRConfig with a
 * global error handler that detects 401 responses and signs the user out.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const signingOut = useRef(false);
  const vercelReconnectRedirecting = useRef(false);
  const vercelReconnectFailureNotifiedFor = useRef<string | null>(null);
  const { session, loading: sessionLoading } = useSession();
  const [theme, setThemeState] = useState<ThemePreference>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("dark");

  const applyThemePreference = useCallback((nextTheme: ThemePreference) => {
    const nextResolvedTheme =
      nextTheme === "system" ? getSystemTheme() : nextTheme;
    setResolvedTheme(nextResolvedTheme);
    applyTheme(nextResolvedTheme);
  }, []);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const initialTheme = isThemePreference(storedTheme)
      ? storedTheme
      : "system";

    setThemeState(initialTheme);
    applyThemePreference(initialTheme);
  }, [applyThemePreference]);

  useEffect(() => {
    if (theme !== "system") {
      return;
    }

    const mediaQuery = window.matchMedia(DARK_MODE_MEDIA_QUERY);

    const handleSystemThemeChange = () => {
      applyThemePreference("system");
    };

    mediaQuery.addEventListener("change", handleSystemThemeChange);
    return () => {
      mediaQuery.removeEventListener("change", handleSystemThemeChange);
    };
  }, [theme, applyThemePreference]);

  const setTheme = useCallback(
    (nextTheme: ThemePreference) => {
      setThemeState(nextTheme);
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      applyThemePreference(nextTheme);
    },
    [applyThemePreference],
  );

  useEffect(() => {
    if (sessionLoading) {
      return;
    }

    const reconnectAttemptedUserId = window.sessionStorage.getItem(
      VERCEL_RECONNECT_ATTEMPT_STORAGE_KEY,
    );

    if (
      session?.authProvider !== "vercel" ||
      !session?.user?.id ||
      !session.vercelReconnectRequired
    ) {
      window.sessionStorage.removeItem(VERCEL_RECONNECT_ATTEMPT_STORAGE_KEY);
      vercelReconnectRedirecting.current = false;
      vercelReconnectFailureNotifiedFor.current = null;
      return;
    }

    if (vercelReconnectRedirecting.current) {
      return;
    }

    if (reconnectAttemptedUserId === session.user.id) {
      if (vercelReconnectFailureNotifiedFor.current !== session.user.id) {
        vercelReconnectFailureNotifiedFor.current = session.user.id;
        toast.error(
          "Couldn't refresh your Vercel session. Sign out and sign back in to retry.",
        );
      }
      return;
    }

    window.sessionStorage.setItem(
      VERCEL_RECONNECT_ATTEMPT_STORAGE_KEY,
      session.user.id,
    );
    vercelReconnectFailureNotifiedFor.current = null;
    vercelReconnectRedirecting.current = true;

    const next = `${window.location.pathname}${window.location.search}`;
    window.location.assign(
      `/api/auth/signin/vercel?next=${encodeURIComponent(next)}`,
    );
  }, [session, sessionLoading]);

  const handleError = useCallback(
    (error: Error) => {
      const isSessionAuthError =
        error instanceof FetchError &&
        error.status === 401 &&
        error.message === "Not authenticated";

      if (isSessionAuthError && !signingOut.current) {
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

  const themeContextValue = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return (
    <ThemeContext.Provider value={themeContextValue}>
      <SWRConfig value={{ onError: handleError }}>
        {children}
        <Suspense fallback={null}>
          <GitHubReconnectGate />
        </Suspense>
      </SWRConfig>
      <Toaster theme={resolvedTheme} />
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used within Providers");
  }

  return context;
}
