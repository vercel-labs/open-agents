"use client";

import { useMemo, type ReactNode } from "react";
import type { ToolRendererProps } from "@/app/lib/render-tool";
import { ToolLayout } from "../../tool-layout";
import {
  parseMcpToolName,
  getActionLabel,
  getProviderIcon,
  getSummary,
  isUUID,
  extractOutputText,
} from "./shared";
import { formatNotionOutput, NOTION_TOOL_LABELS } from "./notion";
import { formatGranolaOutput, GRANOLA_TOOL_LABELS } from "./granola";
import { formatDefaultOutput } from "./default";

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

type OutputFormatter = (rawOutput: unknown) => ReactNode | undefined;

interface ProviderConfig {
  formatter: OutputFormatter;
  toolLabels?: Record<string, string>;
}

/**
 * Registry of provider-specific configurations.
 * To add a new MCP provider:
 * 1. Create a new file (e.g. `figma.tsx`) with a formatter and optional tool labels
 * 2. Add an entry here
 */
const providers: Record<string, ProviderConfig> = {
  notion: {
    formatter: formatNotionOutput,
    toolLabels: NOTION_TOOL_LABELS,
  },
  granola: {
    formatter: formatGranolaOutput,
    toolLabels: GRANOLA_TOOL_LABELS,
  },
};

function getProviderConfig(provider: string): ProviderConfig {
  return providers[provider] ?? { formatter: formatDefaultOutput };
}

// ---------------------------------------------------------------------------
// McpRenderer
// ---------------------------------------------------------------------------

export function McpRenderer({
  part,
  state,
  onApprove,
  onDeny,
}: ToolRendererProps<"dynamic-tool">) {
  const fullToolName =
    part.type === "dynamic-tool" ? part.toolName : String(part.type);
  const { provider, toolName } = parseMcpToolName(fullToolName);
  const config = getProviderConfig(provider);
  const actionLabel = getActionLabel(toolName, provider, config.toolLabels);
  const icon = getProviderIcon(provider);

  const input = part.input as Record<string, unknown> | undefined;
  const rawOutput =
    part.state === "output-available" ? (part.output as unknown) : undefined;

  // If input summary is just a UUID, try to pull a title from the output
  const summary = useMemo(() => {
    const inputSummary = getSummary(input);
    if ((inputSummary === "..." || isUUID(inputSummary)) && rawOutput != null) {
      const text = extractOutputText(rawOutput);
      if (text) {
        try {
          const parsed = JSON.parse(text) as Record<string, unknown>;
          if (typeof parsed.title === "string") return parsed.title;
          if (typeof parsed.name === "string") return parsed.name;
        } catch {
          const titleMatch = text.match(
            /(?:title|name)["=:]\s*"?([^"<\n]{2,60})/i,
          );
          if (titleMatch) return titleMatch[1].trim();
        }
      }
    }
    return inputSummary;
  }, [input, rawOutput]);

  const expandedContent = useMemo(() => {
    if (rawOutput == null) return undefined;
    return config.formatter(rawOutput);
  }, [rawOutput, config]);

  return (
    <ToolLayout
      name={actionLabel}
      icon={icon}
      summary={summary}
      summaryClassName="font-mono"
      state={state}
      expandedContent={expandedContent}
      onApprove={onApprove}
      onDeny={onDeny}
    />
  );
}
