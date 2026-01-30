import { SignInButton } from "@/components/auth/sign-in-button";
import { InstallCommandCard } from "@/components/install-command-card";

export function SignedOutHero() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
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
          <span className="text-lg font-semibold">Open Harness</span>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <h1 className="text-3xl font-light text-foreground">
          Start a task, ship faster
        </h1>
        <p className="mt-3 max-w-md text-sm text-muted-foreground">
          Sign in to kick off coding tasks and track progress in one place.
        </p>
        <div className="mt-8 flex w-full flex-col items-center gap-6">
          <InstallCommandCard />
          <SignInButton />
        </div>
      </main>
    </div>
  );
}
