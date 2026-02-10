"use client";

import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";

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

function handleSignIn(callbackUrl?: string) {
  const fallback = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const redirectPath = resolveRedirectPath(callbackUrl ?? fallback);
  const encodedRedirect = encodeURIComponent(redirectPath);
  window.location.href = `/api/auth/signin/vercel?next=${encodedRedirect}`;
}

type SignInButtonProps = {
  callbackUrl?: string;
} & Omit<ComponentProps<typeof Button>, "onClick">;

export function SignInButton({ callbackUrl, ...props }: SignInButtonProps) {
  return (
    <Button {...props} onClick={() => handleSignIn(callbackUrl)}>
      <VercelIcon className="mr-2 h-4 w-4" />
      Sign in with Vercel
    </Button>
  );
}
