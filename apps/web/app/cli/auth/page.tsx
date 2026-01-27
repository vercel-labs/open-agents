"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useState, useEffect, Suspense } from "react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { useSession } from "@/hooks/use-session";

function formatCode(value: string) {
  // Remove any non-alphanumeric characters and uppercase
  const cleaned = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  // Add dash after 4 characters if we have more than 4
  if (cleaned.length > 4) {
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}`;
  }
  return cleaned;
}

function CLIAuthContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { session } = useSession();

  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Pre-fill code from URL parameter
  useEffect(() => {
    const codeParam = searchParams.get("code");
    if (codeParam) {
      setCode(codeParam);
    }
  }, [searchParams]);

  // Auto-detect device name from user agent
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

  if (success) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
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
            You can now close this window and return to your terminal. The CLI
            has been authorized for{" "}
            <span className="font-medium text-foreground">
              {session?.user?.username}
            </span>
            .
          </p>
          <button
            onClick={() => router.push("/")}
            className="text-sm text-muted-foreground underline hover:text-foreground"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
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
              placeholder="My MacBook"
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

        <p className="text-center text-xs text-muted-foreground">
          Signed in as{" "}
          <span className="font-medium text-foreground">
            {session?.user?.username}
          </span>
        </p>
      </div>
    </div>
  );
}

function CLIAuthPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          Loading...
        </div>
      }
    >
      <CLIAuthContent />
    </Suspense>
  );
}

export default function Page() {
  return (
    <AuthGuard>
      <CLIAuthPage />
    </AuthGuard>
  );
}
