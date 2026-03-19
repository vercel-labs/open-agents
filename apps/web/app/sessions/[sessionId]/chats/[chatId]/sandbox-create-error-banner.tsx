import { X } from "lucide-react";
import Link from "next/link";
import type { SandboxCreateErrorDetails } from "./sandbox-create";

function isSafeActionUrl(url: string): boolean {
  if (url.startsWith("/")) {
    return true;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function SandboxCreateErrorBanner({
  error,
  onDismiss,
}: {
  error: SandboxCreateErrorDetails;
  onDismiss: () => void;
}) {
  const actionUrl =
    error.actionUrl && isSafeActionUrl(error.actionUrl)
      ? error.actionUrl
      : null;

  return (
    <div className="flex items-start justify-between rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <span>{error.message}</span>
        {actionUrl ? (
          <Link
            href={actionUrl}
            className="font-medium underline underline-offset-4 hover:no-underline"
          >
            Reconnect GitHub
          </Link>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-2 rounded p-0.5 hover:bg-destructive/20"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
