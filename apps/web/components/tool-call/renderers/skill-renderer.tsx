"use client";

import { Zap } from "lucide-react";
import type { ToolRendererProps } from "@/app/lib/render-tool";
import { ToolLayout } from "../tool-layout";

function getDisplayString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function SkillRenderer({
  part,
  state,
  onApprove,
  onDeny,
}: ToolRendererProps<"tool-skill">) {
  const input = part.input;
  const skillName = getDisplayString(input?.skill);
  const rawArgs = getDisplayString(input?.args);

  const output = part.state === "output-available" ? part.output : undefined;
  const outputError =
    output?.success === false ? (output?.error ?? "Skill failed") : undefined;

  const mergedState = outputError
    ? { ...state, error: state.error ?? outputError }
    : state;

  const expandedContent = rawArgs ? (
    <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/50 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
      {rawArgs}
    </pre>
  ) : undefined;

  return (
    <ToolLayout
      name="Skill"
      icon={<Zap className="h-3.5 w-3.5" />}
      summary={skillName ? `/${skillName}` : "..."}
      summaryClassName="font-mono"
      state={mergedState}
      nameClassName={mergedState.error ? "text-red-500" : undefined}
      expandedContent={expandedContent}
      onApprove={onApprove}
      onDeny={onDeny}
    />
  );
}
