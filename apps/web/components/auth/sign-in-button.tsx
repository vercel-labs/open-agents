"use client";

import { Loader2 } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";

function VercelIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 1L24 22H0L12 1Z" />
    </svg>
  );
}

function resolveRedirectPath(value: string): string {
  if (value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }

  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin === window.location.origin) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    return window.location.pathname + window.location.search;
  }

  return window.location.pathname + window.location.search;
}

type SignInButtonProps = {
  callbackUrl?: string;
} & Omit<ComponentProps<typeof Button>, "onClick">;

export function SignInButton({
  callbackUrl,
  disabled,
  ...props
}: SignInButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  function handleSignIn() {
    if (disabled || isLoading) {
      return;
    }

    const fallback = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const redirectPath = resolveRedirectPath(callbackUrl ?? fallback);

    setIsLoading(true);
    authClient.signIn.social({
      provider: "vercel",
      callbackURL: redirectPath,
    });
  }

  return (
    <Button
      {...props}
      aria-busy={isLoading}
      disabled={disabled || isLoading}
      onClick={handleSignIn}
    >
      {isLoading ? <Loader2 className="animate-spin" /> : <VercelIcon />}
      {isLoading ? "Signing in..." : "Sign in with Vercel"}
    </Button>
  );
}
