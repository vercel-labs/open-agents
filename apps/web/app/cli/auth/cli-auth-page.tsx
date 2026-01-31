"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { SignInButton } from "@/components/auth/sign-in-button";
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

function CLIAuthSignedOut() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0a0a0b] px-6 py-12">
      {/* Ambient glow effects */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-0 h-[500px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/[0.08] blur-[120px]" />
        <div className="absolute bottom-0 left-0 h-[300px] w-[400px] -translate-x-1/2 translate-y-1/2 rounded-full bg-blue-500/[0.05] blur-[100px]" />
      </div>

      {/* Dot grid pattern */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.4]"
        style={{
          backgroundImage:
            "radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      {/* Scanline effect */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 4px)",
        }}
      />

      <div className="relative z-10 w-full max-w-md">
        {/* Terminal window */}
        <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#111113]/90 shadow-2xl shadow-black/50 backdrop-blur-xl">
          {/* Window chrome */}
          <div className="flex items-center gap-2 border-b border-white/[0.06] bg-white/[0.02] px-4 py-3">
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-full bg-[#ff5f57]" />
              <div className="h-3 w-3 rounded-full bg-[#febc2e]" />
              <div className="h-3 w-3 rounded-full bg-[#28c840]" />
            </div>
            <div className="ml-4 flex-1 text-center">
              <span className="font-mono text-xs text-white/30">
                openharness auth
              </span>
            </div>
            <div className="w-[52px]" />
          </div>

          {/* Terminal content */}
          <div className="p-6">
            {/* Command prompt animation */}
            <div className="mb-6 font-mono text-sm">
              <div className="flex items-center gap-2 text-white/40">
                <span className="text-emerald-400">$</span>
                <span>openharness auth login</span>
                <span className="inline-block h-4 w-2 animate-pulse bg-emerald-400/80" />
              </div>
              <div className="mt-2 text-white/30">
                <span className="text-amber-400/80">!</span> Authentication
                required
              </div>
            </div>

            {/* Divider */}
            <div className="mb-6 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

            {/* Main content */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03]">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    className="h-5 w-5 text-white/60"
                  >
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-lg font-medium tracking-tight text-white">
                    Sign in to continue
                  </h1>
                  <p className="text-sm text-white/40">
                    Authorize your CLI session
                  </p>
                </div>
              </div>

              <p className="text-sm leading-relaxed text-white/50">
                Connect your GitHub account to authorize the Open Harness CLI.
                Your session will be linked to this device.
              </p>

              <SignInButton
                callbackUrl="/cli/auth"
                size="lg"
                className="mt-2 h-11 w-full border-0 bg-white text-sm font-medium text-black transition-all hover:bg-white/90"
              />

              <div className="flex items-center justify-center gap-2 pt-2">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="h-3.5 w-3.5 text-white/30"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <span className="text-xs text-white/30">
                  Secured with OAuth 2.0
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Floating badge */}
        <div className="mt-6 flex justify-center">
          <div className="flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.02] px-4 py-2 backdrop-blur">
            <div className="flex h-5 w-5 items-center justify-center rounded border border-white/[0.1] bg-white/[0.03]">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-3 w-3 text-white/50"
              >
                <polyline points="4,17 10,11 4,5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
            </div>
            <span className="text-xs font-medium text-white/50">
              Open Harness
            </span>
          </div>
        </div>
      </div>
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
    return <CLIAuthSignedOut />;
  }

  if (!isAuthenticated && !loading) {
    return <CLIAuthSignedOut />;
  }

  return <CLIAuthContent initialCode={initialCode} />;
}
