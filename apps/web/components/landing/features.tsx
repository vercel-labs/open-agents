"use client";

import type { ReactNode } from "react";
import { FeatureAgent } from "./feature-agent";
import { FeatureSandbox } from "./feature-sandbox";
import { FeatureWorkflow } from "./feature-workflow";
import { Stage, type StageTone } from "./stage";
import { Window } from "./window";

function Spotlight({
  tone,
  title,
  description,
  bullets,
  flip,
  window: windowContent,
}: {
  readonly tone: StageTone;
  readonly title: string;
  readonly description: string;
  readonly bullets: readonly string[];
  readonly flip?: boolean;
  readonly window: ReactNode;
}) {
  return (
    <div className="grid items-center gap-8 md:grid-cols-2 md:gap-16">
      <div className={flip ? "order-1 md:order-2" : "order-1 md:order-1"}>
        <h2 className="text-2xl font-semibold tracking-tighter sm:text-3xl md:text-4xl">
          {title}
        </h2>
        <p className="mt-4 text-base leading-relaxed text-(--l-fg-3) sm:mt-5 sm:text-lg">
          {description}
        </p>
        <ul className="mt-6 space-y-3 sm:mt-8">
          {bullets.map((b) => (
            <li key={b} className="flex items-center gap-3 text-(--l-fg-2)">
              <span className="h-1.5 w-1.5 rounded-full bg-(--l-fg-3)" />
              {b}
            </li>
          ))}
        </ul>
      </div>

      <div className={flip ? "order-2 md:order-1" : "order-2 md:order-2"}>
        <Stage tone={tone}>
          <div className="mx-auto w-full max-w-[1160px]">
            <Window>{windowContent}</Window>
          </div>
        </Stage>
      </div>
    </div>
  );
}

export function LandingFeatures() {
  return (
    <section>
      <div className="mx-auto max-w-[1320px] px-4 pb-14 pt-14 sm:px-6 md:pb-28 md:pt-28">
        <div className="space-y-12 sm:space-y-16 md:space-y-28">
          <Spotlight
            tone="slate"
            title="Agents that ship real code."
            description="Each agent gets a full sandbox environment with filesystem, network, and runtime access. Describe what to build and let the agent work autonomously until it's done."
            bullets={[
              "File ops, search, shell, and task delegation built in",
              "Explorer and executor subagents for parallel work",
              "Multi-model support with AI Gateway",
            ]}
            window={<FeatureAgent />}
          />

          <Spotlight
            tone="ash"
            title="Cloud sandboxes, not local machines."
            description="Every session runs in an isolated Vercel sandbox with its own branch. Work is committed and pushed automatically — nothing is lost when the sandbox expires."
            bullets={[
              "Ephemeral environments with full git integration",
              "Auto-hibernate on inactivity, instant restore",
              "Snapshot and restore filesystem state",
            ]}
            flip
            window={<FeatureSandbox />}
          />

          <Spotlight
            tone="iron"
            title="Durable workflows that survive anything."
            description="Agent loops run as durable workflows that survive restarts, retry on failure, and coordinate multi-step operations over time. No work is ever lost mid-run."
            bullets={[
              "Resumable agent loops with automatic checkpointing",
              "Post-finish: usage tracking, diff caching, auto-commit",
              "Reconnect to running workflows from any client",
            ]}
            window={<FeatureWorkflow />}
          />
        </div>
      </div>
    </section>
  );
}
