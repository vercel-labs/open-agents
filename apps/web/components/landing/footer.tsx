import { ThemeToggle } from "./theme-toggle";

export function LandingFooter() {
  return (
    <footer>
      <div className="mx-auto max-w-[1320px] border-t border-(--l-border) px-6 py-14 md:py-18">
        <div className="grid gap-10 sm:grid-cols-2 md:grid-cols-3">
          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-(--l-fg-4)">
              Open Agents
            </div>
            <div className="mt-3 text-sm text-(--l-fg-3)">
              Open Agents for
              <br />
              shipping code.
            </div>
          </div>

          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-(--l-fg-4)">
              Product
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <a
                href="https://ai-sdk.dev/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-sm text-(--l-fg-3) transition-colors hover:text-(--l-fg)"
              >
                AI SDK
              </a>
              <a
                href="https://vercel.com/ai-gateway"
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-sm text-(--l-fg-3) transition-colors hover:text-(--l-fg)"
              >
                AI Gateway
              </a>
              <a
                href="https://vercel.com/sandbox"
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-sm text-(--l-fg-3) transition-colors hover:text-(--l-fg)"
              >
                Sandbox
              </a>
              <a
                href="https://useworkflow.dev/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-sm text-(--l-fg-3) transition-colors hover:text-(--l-fg)"
              >
                Workflow SDK
              </a>
            </div>
          </div>

          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-(--l-fg-4)">
              Links
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <a
                href="https://github.com/vercel-labs/open-harness"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-(--l-fg-3) transition-colors hover:text-(--l-fg)"
              >
                GitHub
              </a>
              <a
                href="https://vercel.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-(--l-fg-3) transition-colors hover:text-(--l-fg)"
              >
                Vercel
              </a>
              <a
                href="https://ai-sdk.dev/docs/introduction"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-(--l-fg-3) transition-colors hover:text-(--l-fg)"
              >
                AI SDK Docs
              </a>
            </div>
          </div>
        </div>

        <div className="mt-10 flex items-center justify-between">
          <a
            href="https://vercel.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-(--l-fg-4) transition-colors hover:text-(--l-fg-2)"
          >
            <svg
              viewBox="0 0 76 65"
              className="h-4"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
            </svg>
          </a>
          <ThemeToggle />
        </div>
      </div>
    </footer>
  );
}
