import { executorSubagent } from "./executor";
import { explorerSubagent } from "./explorer";

export const SUBAGENT_REGISTRY = {
  explorer: {
    name: "Explorer",
    shortDescription: "Fast, read-only codebase exploration",
    agent: explorerSubagent,
  },
  executor: {
    name: "Executor",
    shortDescription: "Autonomous implementation for well-defined tasks",
    agent: executorSubagent,
  },
} as const;

export const SUBAGENT_TYPES = Object.keys(SUBAGENT_REGISTRY) as [
  keyof typeof SUBAGENT_REGISTRY,
  ...(keyof typeof SUBAGENT_REGISTRY)[],
];

export type SubagentType = keyof typeof SUBAGENT_REGISTRY;

export function buildSubagentSummaryLines(): string {
  return SUBAGENT_TYPES.map((type) => {
    const subagent = SUBAGENT_REGISTRY[type];
    return `- \`${type}\` (${subagent.name}) - ${subagent.shortDescription}`;
  }).join("\n");
}
