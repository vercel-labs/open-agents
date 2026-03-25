"use client";

import { useMemo, useState } from "react";

type Tone = "input" | "plain" | "dim" | "ok" | "muted";
type Line = { readonly tone: Tone; readonly text: string };
type Scene = { readonly name: string; readonly data: readonly Line[] };

const scenes: readonly Scene[] = [
  {
    name: "agent",
    data: [
      { tone: "muted", text: "> build the auth flow with github oauth" },
      { tone: "dim", text: "anthropic/claude-opus-4.6" },
      { tone: "plain", text: "" },
      { tone: "ok", text: "searching files matching auth*" },
      { tone: "ok", text: "reading lib/session.ts (142 lines)" },
      { tone: "ok", text: "creating app/api/auth/route.ts" },
      { tone: "ok", text: "creating app/api/auth/callback/route.ts" },
      { tone: "ok", text: "editing middleware.ts" },
      { tone: "ok", text: "running bun run typecheck" },
      { tone: "plain", text: "" },
      { tone: "plain", text: "auth flow is live. created 2 route handlers," },
      { tone: "plain", text: "session middleware, and callback endpoint." },
      { tone: "plain", text: "typecheck passes clean." },
    ],
  },
  {
    name: "sandbox",
    data: [
      { tone: "muted", text: "> refactor the api to use edge runtime" },
      { tone: "dim", text: "sandbox: vercel (feat/edge-api)" },
      { tone: "plain", text: "" },
      { tone: "ok", text: "reading app/api/chat/route.ts" },
      { tone: "ok", text: "reading app/api/chat/[chatId]/stream/route.ts" },
      {
        tone: "ok",
        text: "editing route.ts \u2014 export const runtime = 'edge'",
      },
      { tone: "ok", text: "editing stream/route.ts \u2014 remove node apis" },
      { tone: "ok", text: "running bun run ci" },
      { tone: "plain", text: "" },
      { tone: "plain", text: "migrated 2 routes to edge runtime." },
      { tone: "dim", text: "  +8 -14 app/api/chat/route.ts" },
      {
        tone: "dim",
        text: "  +12 -23 app/api/chat/[chatId]/stream/route.ts",
      },
      { tone: "ok", text: "auto-commit: WIP: migrate api to edge runtime" },
      { tone: "ok", text: "pushed to origin/feat/edge-api" },
    ],
  },
  {
    name: "subagent",
    data: [
      { tone: "muted", text: "> find all unused exports and remove them" },
      { tone: "dim", text: "delegating to explorer subagent..." },
      { tone: "plain", text: "" },
      { tone: "ok", text: "glob **/*.ts (247 files)" },
      { tone: "ok", text: "grep export function|const across codebase" },
      { tone: "ok", text: "cross-referencing import statements" },
      { tone: "plain", text: "" },
      { tone: "plain", text: "found 6 unused exports:" },
      { tone: "dim", text: "  lib/utils.ts:12      formatDate" },
      { tone: "dim", text: "  lib/utils.ts:45      parseConfig" },
      { tone: "dim", text: "  lib/crypto.ts:8      hashToken" },
      { tone: "dim", text: "  lib/sandbox/utils.ts:22  normalizePath" },
      { tone: "dim", text: "  hooks/use-theme.ts:5     useTheme" },
      { tone: "dim", text: "  components/badge.tsx:3    Badge" },
      { tone: "plain", text: "" },
      { tone: "muted", text: "removing 6 dead exports across 5 files..." },
    ],
  },
];

function lineStyle(tone: Tone): string {
  switch (tone) {
    case "input":
      return "text-(--l-panel-fg)";
    case "dim":
      return "text-(--l-panel-fg-4)";
    case "ok":
      return "text-(--l-panel-fg)";
    case "muted":
      return "text-(--l-panel-fg-2)";
    default:
      return "text-(--l-panel-fg)";
  }
}

export function HeroTerminal() {
  const [slot, setSlot] = useState(0);
  const active = scenes[slot]!;
  const rows = useMemo(() => active.data, [active]);

  return (
    <div className="group flex h-[420px] flex-col transition-all duration-300 md:h-[480px]">
      <div className="flex items-center justify-between border-b border-(--l-panel-border) bg-(--l-panel-surface) px-3 py-2">
        <div className="flex items-center gap-3 font-mono text-[11px] tabular-nums text-(--l-panel-fg-2)">
          <div>
            mode <span className="text-(--l-panel-fg)">{active.name}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px] text-(--l-panel-fg-2)">
          <span className="inline-flex size-1.5 rounded-full bg-(--l-accent)/70" />
          running
        </div>
      </div>

      <div className="terminal-scroll flex-1 overflow-y-auto bg-(--l-code-bg) px-4 py-3 font-mono text-[12px] leading-[1.62] tabular-nums">
        {rows.map((row, index) => (
          <div
            key={`${active.name}-${index}`}
            className={`${lineStyle(row.tone)} transition-colors duration-150`}
          >
            {row.text || "\u00A0"}
          </div>
        ))}
      </div>

      <div className="border-t border-(--l-panel-border) bg-(--l-panel-surface) px-2 py-1.5">
        <div className="terminal-scroll flex items-center gap-1 overflow-x-auto font-mono text-[11px] text-(--l-panel-fg-2)">
          {scenes.map((scene, index) => {
            const current = index === slot;
            return (
              <button
                key={scene.name}
                type="button"
                onClick={() => setSlot(index)}
                className={`shrink-0 rounded-sm border px-2.5 py-1 transition-colors duration-150 ${
                  current
                    ? "border-(--l-panel-border) bg-(--l-panel-active) text-(--l-panel-fg)"
                    : "border-transparent text-(--l-panel-fg-2) hover:border-(--l-panel-border) hover:text-(--l-panel-fg)"
                }`}
              >
                {current ? `*${scene.name}` : scene.name}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
