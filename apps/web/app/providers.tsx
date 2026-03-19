"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Toaster } from "sonner";
import { SWRConfig } from "swr";
import { FetchError } from "@/lib/swr";

const THEME_STORAGE_KEY = "open-harness-theme";
const BROWSER_NOTIFICATIONS_ENABLED_STORAGE_KEY =
  "open-harness-browser-notifications-enabled";
const DARK_MODE_MEDIA_QUERY = "(prefers-color-scheme: dark)";
const APP_NOTIFICATION_ICON_PATH = "/favicon.ico";
const BROWSER_NOTIFICATION_SERVICE_WORKER_PATH = "/browser-notifications-sw.js";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
export type BrowserNotificationPermission =
  | NotificationPermission
  | "unsupported";

interface ThemeContextValue {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
}

interface BrowserNotificationOptions {
  title: string;
  body?: string;
  tag?: string;
  url?: string;
}

interface BrowserNotificationContextValue {
  enabled: boolean;
  isSupported: boolean;
  permission: BrowserNotificationPermission;
  canSendNotifications: boolean;
  setEnabled: (enabled: boolean) => void;
  requestPermission: () => Promise<BrowserNotificationPermission>;
  showNotification: (options: BrowserNotificationOptions) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const BrowserNotificationContext =
  createContext<BrowserNotificationContextValue | null>(null);

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

function getBrowserNotificationPermission(): BrowserNotificationPermission {
  if (
    typeof window === "undefined" ||
    typeof window.Notification === "undefined"
  ) {
    return "unsupported";
  }

  return window.Notification.permission;
}

function focusWindowAndNavigate(url: string) {
  try {
    window.focus();
  } catch {
    // Ignore focus failures and still attempt navigation.
  }

  window.location.href = url;
}

/**
 * Global providers for the app. Wraps children in SWRConfig with a
 * global error handler that detects 401 responses and signs the user out.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const signingOut = useRef(false);
  const serviceWorkerRegistrationRef = useRef<ServiceWorkerRegistration | null>(
    null,
  );
  const [theme, setThemeState] = useState<ThemePreference>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("dark");
  const [browserNotificationsEnabled, setBrowserNotificationsEnabledState] =
    useState(false);
  const [browserNotificationPermission, setBrowserNotificationPermission] =
    useState<BrowserNotificationPermission>("unsupported");

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

  useEffect(() => {
    const storedEnabled =
      window.localStorage.getItem(BROWSER_NOTIFICATIONS_ENABLED_STORAGE_KEY) ===
      "true";
    const syncPermission = () => {
      setBrowserNotificationPermission(getBrowserNotificationPermission());
    };

    setBrowserNotificationsEnabledState(storedEnabled);
    syncPermission();

    document.addEventListener("visibilitychange", syncPermission);
    window.addEventListener("focus", syncPermission);
    return () => {
      document.removeEventListener("visibilitychange", syncPermission);
      window.removeEventListener("focus", syncPermission);
    };
  }, []);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      typeof window.Notification === "undefined"
    ) {
      return;
    }

    navigator.serviceWorker
      .register(BROWSER_NOTIFICATION_SERVICE_WORKER_PATH)
      .then((registration) => {
        serviceWorkerRegistrationRef.current = registration;
      })
      .catch(() => undefined);
  }, []);

  const setTheme = useCallback(
    (nextTheme: ThemePreference) => {
      setThemeState(nextTheme);
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      applyThemePreference(nextTheme);
    },
    [applyThemePreference],
  );

  const setBrowserNotificationsEnabled = useCallback((nextEnabled: boolean) => {
    setBrowserNotificationsEnabledState(nextEnabled);
    window.localStorage.setItem(
      BROWSER_NOTIFICATIONS_ENABLED_STORAGE_KEY,
      nextEnabled ? "true" : "false",
    );
  }, []);

  const requestBrowserNotificationPermission = useCallback(async () => {
    const currentPermission = getBrowserNotificationPermission();

    if (currentPermission === "unsupported") {
      return currentPermission;
    }

    if (currentPermission !== "default") {
      setBrowserNotificationPermission(currentPermission);
      return currentPermission;
    }

    const nextPermission = await window.Notification.requestPermission();
    setBrowserNotificationPermission(nextPermission);
    return nextPermission;
  }, []);

  const canSendBrowserNotifications =
    browserNotificationsEnabled && browserNotificationPermission === "granted";

  const showBrowserNotification = useCallback(
    ({ title, body, tag, url }: BrowserNotificationOptions) => {
      if (!canSendBrowserNotifications || typeof window === "undefined") {
        return;
      }

      const notificationOptions = {
        body,
        data: url ? { url } : undefined,
        icon: APP_NOTIFICATION_ICON_PATH,
        renotify: Boolean(tag),
        tag,
      };

      const showFallbackNotification = () => {
        try {
          const notification = new window.Notification(
            title,
            notificationOptions,
          );

          if (url) {
            notification.addEventListener("click", () => {
              notification.close();
              focusWindowAndNavigate(url);
            });
          }
        } catch {
          // Ignore notification failures.
        }
      };

      const serviceWorkerRegistration = serviceWorkerRegistrationRef.current;
      if (serviceWorkerRegistration) {
        void serviceWorkerRegistration
          .showNotification(title, notificationOptions)
          .catch(() => {
            showFallbackNotification();
          });
        return;
      }

      if ("serviceWorker" in navigator) {
        void navigator.serviceWorker
          .getRegistration()
          .then((registration) => {
            if (!registration) {
              showFallbackNotification();
              return;
            }

            serviceWorkerRegistrationRef.current = registration;
            return registration.showNotification(title, notificationOptions);
          })
          .catch(() => {
            showFallbackNotification();
          });
        return;
      }

      showFallbackNotification();
    },
    [canSendBrowserNotifications],
  );

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
  const browserNotificationContextValue = useMemo(
    () => ({
      enabled: browserNotificationsEnabled,
      isSupported: browserNotificationPermission !== "unsupported",
      permission: browserNotificationPermission,
      canSendNotifications: canSendBrowserNotifications,
      setEnabled: setBrowserNotificationsEnabled,
      requestPermission: requestBrowserNotificationPermission,
      showNotification: showBrowserNotification,
    }),
    [
      browserNotificationsEnabled,
      browserNotificationPermission,
      canSendBrowserNotifications,
      requestBrowserNotificationPermission,
      setBrowserNotificationsEnabled,
      showBrowserNotification,
    ],
  );

  return (
    <ThemeContext.Provider value={themeContextValue}>
      <BrowserNotificationContext.Provider
        value={browserNotificationContextValue}
      >
        <SWRConfig value={{ onError: handleError }}>{children}</SWRConfig>
        <Toaster theme={resolvedTheme} />
      </BrowserNotificationContext.Provider>
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

export function useBrowserNotifications() {
  const context = useContext(BrowserNotificationContext);

  if (!context) {
    throw new Error("useBrowserNotifications must be used within Providers");
  }

  return context;
}
