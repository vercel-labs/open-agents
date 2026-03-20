export function LandingFooter() {
  return (
    <footer>
      <div className="mx-auto max-w-[1320px] border-t border-white/[0.06] px-6 py-14 md:py-18">
        <div className="grid gap-10 sm:grid-cols-2 md:grid-cols-4">
          <div className="flex h-full flex-col">
            <div className="font-mono text-xs uppercase tracking-widest text-white/35">
              Open Harness
            </div>
            <div className="mt-3 text-sm text-white/40">
              Open cloud agents for
              <br />
              shipping code.
            </div>
            <a
              href="https://vercel.com"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-auto block pt-6 text-white/35 transition-colors hover:text-white/60"
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
          </div>

          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-white/35">
              Product
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <a
                href="https://ai-sdk.dev/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-sm text-white/45 transition-colors hover:text-white"
              >
                AI SDK
              </a>
              <a
                href="https://vercel.com/ai-gateway"
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-sm text-white/45 transition-colors hover:text-white"
              >
                AI Gateway
              </a>
              <a
                href="https://vercel.com/sandbox"
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-sm text-white/45 transition-colors hover:text-white"
              >
                Sandbox
              </a>
              <a
                href="https://useworkflow.dev/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-sm text-white/45 transition-colors hover:text-white"
              >
                Workflow DevKit
              </a>
            </div>
          </div>

          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-white/35">
              Agent
            </div>
            <div className="mt-4 flex flex-col gap-2 font-mono text-sm text-white/45">
              <span>read / write / edit</span>
              <span>grep / glob / bash</span>
              <span>task / todo / skill</span>
            </div>
          </div>

          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-white/35">
              Links
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <a
                href="https://github.com/vercel-labs/open-harness"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-white/45 transition-colors hover:text-white"
              >
                GitHub
              </a>
              <a
                href="https://vercel.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-white/45 transition-colors hover:text-white"
              >
                Vercel
              </a>
              <a
                href="https://ai-sdk.dev/docs/introduction"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-white/45 transition-colors hover:text-white"
              >
                AI SDK Docs
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
