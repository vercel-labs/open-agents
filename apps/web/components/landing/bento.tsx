import { SignInButton } from "@/components/auth/sign-in-button";

type BentoItem = {
  readonly id: string;
  readonly title: string;
  readonly body: string;
};

const items: readonly BentoItem[] = [
  {
    id: "001",
    title: "AI SDK",
    body: "Unified interface across models. Switch providers, stream responses, and call tools with a single API.",
  },
  {
    id: "002",
    title: "AI Gateway",
    body: "Route requests across providers with built-in fallbacks, rate limiting, and observability.",
  },
  {
    id: "003",
    title: "Sandbox",
    body: "Secure, isolated environments for every session. Full filesystem, network, and runtime access.",
  },
  {
    id: "004",
    title: "Workflow SDK",
    body: "Durable, resumable agent workflows that survive restarts and coordinate multi-step operations.",
  },
];

function mark(index: number) {
  if (index === 0) {
    return (
      <div className="grid grid-cols-2 gap-1" aria-hidden="true">
        <span className="size-2 border border-(--l-fg-4)" />
        <span className="size-2 border border-(--l-fg-4)" />
        <span className="size-2 border border-(--l-fg-4)" />
        <span className="size-2 border border-(--l-fg-4)" />
      </div>
    );
  }
  if (index === 1) {
    return (
      <div className="flex items-center gap-1.5" aria-hidden="true">
        <span className="h-px w-4 bg-(--l-fg-4)" />
        <span className="h-px w-6 bg-(--l-fg-4)" />
        <span className="h-px w-3 bg-(--l-fg-4)" />
      </div>
    );
  }
  if (index === 2) {
    return (
      <div className="flex flex-col gap-1" aria-hidden="true">
        <span className="h-1 w-8 border border-(--l-fg-4)" />
        <span className="h-1 w-6 border border-(--l-fg-4)" />
        <span className="h-1 w-4 border border-(--l-fg-4)" />
      </div>
    );
  }
  return (
    <div className="relative h-6 w-8" aria-hidden="true">
      <span className="absolute left-0 top-0 size-2 border border-(--l-fg-4)" />
      <span className="absolute right-0 top-0 size-2 border border-(--l-fg-4)" />
      <span className="absolute bottom-0 left-1/2 size-2 -translate-x-1/2 border border-(--l-fg-4)" />
    </div>
  );
}

export function LandingBento() {
  return (
    <section>
      <div className="mx-auto max-w-[1320px] border-t border-(--l-border-subtle)">
        <div className="grid gap-6 border-b border-(--l-border) px-6 py-14 pb-10 sm:gap-10 sm:px-10 md:grid-cols-2 md:gap-0 md:pb-14 md:py-28">
          <div>
            <h2 className="text-balance text-3xl font-semibold leading-[1.05] tracking-tighter sm:text-4xl md:text-6xl">
              Infrastructure
              <br />
              that ships.
            </h2>
          </div>
          <div className="md:pl-10">
            <p className="max-w-md text-balance text-base leading-relaxed text-(--l-fg-2)">
              Built on production-grade primitives from the Vercel ecosystem. No
              synthetic demos &mdash; real infrastructure for real agents.
            </p>
            <div className="mt-6">
              <SignInButton />
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4">
          {items.map((item, index) => (
            <article
              key={item.id}
              className={`flex h-full flex-col border-b border-(--l-border) px-6 py-8 md:px-10 md:py-9 ${
                index % 2 === 1 ? "md:border-l md:border-l-(--l-border)" : ""
              } ${index >= 2 ? "md:border-b-0" : ""} ${
                index > 0
                  ? "lg:border-l lg:border-l-(--l-border)"
                  : "lg:border-l-0"
              } lg:border-b-0`}
            >
              <div className="font-mono text-[11px] text-(--l-fg-4)">
                {item.id}
              </div>
              <div className="mt-7 flex h-10 items-center">{mark(index)}</div>
              <h3 className="mt-7 text-balance text-2xl font-semibold tracking-tighter">
                {item.title}
              </h3>
              <p className="mt-4 flex-1 text-pretty text-sm leading-relaxed text-(--l-fg-2)">
                {item.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
