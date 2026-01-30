"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { SignedOutHero } from "@/components/auth/signed-out-hero";
import { UserAvatarDropdown } from "@/components/user-avatar-dropdown";
import { useSession } from "@/hooks/use-session";

interface CLIAuthPageProps {
  hasSessionCookie: boolean;
  initialCode: string;
}

interface CLIAuthContentProps {
  initialCode: string;
}

function formatCode(value: string) {
  const cleaned = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (cleaned.length > 4) {
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}`;
  }
  return cleaned;
}

function CLIAuthHeader() {
  return (
    <header className="flex items-center justify-between px-6 py-4">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="h-4 w-4"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
        </div>
        <span className="mt-px text-lg font-semibold leading-none">
          Open Harness
        </span>
      </div>
      <div className="h-8 w-8 shrink-0">
        <UserAvatarDropdown />
      </div>
    </header>
  );
}

function CLIAuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <CLIAuthHeader />
      <main className="flex flex-1 items-center justify-center px-4 pb-2">
        {children}
      </main>
    </div>
  );
}

function CLIAuthContent({ initialCode }: CLIAuthContentProps) {
  const router = useRouter();
  const { session } = useSession();
  const [code, setCode] = useState(() => formatCode(initialCode));
  const [deviceName, setDeviceName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const ua = navigator.userAgent;
      if (ua.includes("Mac")) {
        setDeviceName("Mac");
      } else if (ua.includes("Windows")) {
        setDeviceName("Windows PC");
      } else if (ua.includes("Linux")) {
        setDeviceName("Linux");
      }
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/cli/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_code: code,
          device_name: deviceName || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to verify code");
        return;
      }

      setSuccess(true);
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCode(e.target.value);
    setCode(formatted);
  };

  const username = session?.user?.username;

  if (success) {
    return (
      <CLIAuthShell>
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
            <svg
              className="h-8 w-8 text-green-600 dark:text-green-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-foreground">
            CLI Authorized
          </h1>
          <p className="text-muted-foreground">
            You can now close this window and return to your terminal.
            {username ? (
              <>
                {" "}
                The CLI has been authorized for{" "}
                <span className="font-medium text-foreground">{username}</span>.
              </>
            ) : (
              " The CLI has been authorized."
            )}
          </p>
          <button
            onClick={() => router.push("/")}
            className="text-sm text-muted-foreground underline hover:text-foreground"
          >
            Go to Dashboard
          </button>
        </div>
      </CLIAuthShell>
    );
  }

  return (
    <CLIAuthShell>
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-border">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-6 w-6"
            >
              <polyline points="4,17 10,11 4,5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-foreground">
            Authorize CLI
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter the code displayed in your terminal to authorize the Open
            Harness CLI.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="code"
              className="block text-sm font-medium text-foreground"
            >
              Verification Code
            </label>
            <input
              type="text"
              id="code"
              value={code}
              onChange={handleCodeChange}
              placeholder="XXXX-XXXX"
              className="mt-1 block w-full rounded-md border border-border bg-background px-4 py-3 text-center text-2xl font-mono tracking-widest text-foreground placeholder:text-muted-foreground focus:border-foreground focus:outline-none focus:ring-1 focus:ring-foreground"
              maxLength={9}
              autoComplete="off"
            />
          </div>

          <div>
            <label
              htmlFor="deviceName"
              className="block text-sm font-medium text-foreground"
            >
              Device Name{" "}
              <span className="text-muted-foreground">(optional)</span>
            </label>
            <input
              type="text"
              id="deviceName"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder=""
              className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground focus:border-foreground focus:outline-none focus:ring-1 focus:ring-foreground"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Help identify this device in your account settings
            </p>
          </div>

          {error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || code.length < 9}
            className="w-full rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Authorizing..." : "Authorize CLI"}
          </button>
        </form>

        <p
          className={`text-center text-xs text-muted-foreground ${
            username ? "" : "opacity-0"
          }`}
        >
          Signed in as{" "}
          <span className="font-medium text-foreground">{username ?? ""}</span>
        </p>
      </div>
    </CLIAuthShell>
  );
}

export function CLIAuthPage({
  hasSessionCookie,
  initialCode,
}: CLIAuthPageProps) {
  const { loading, isAuthenticated } = useSession();

  if (!hasSessionCookie) {
    return <SignedOutHero />;
  }

  if (!isAuthenticated && !loading) {
    return <SignedOutHero />;
  }

  return <CLIAuthContent initialCode={initialCode} />;
}
