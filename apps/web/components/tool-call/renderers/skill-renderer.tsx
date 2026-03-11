"use client";

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
  const argsPreview = rawArgs?.replace(/[\r\n]+/g, " ");

  const output = part.state === "output-available" ? part.output : undefined;
  const skillPath = getDisplayString(output?.skillPath);
  const outputError =
    output?.success === false ? (output?.error ?? "Skill failed") : undefined;

  const mergedState = outputError
    ? { ...state, error: state.error ?? outputError }
    : state;

  const meta = argsPreview ? (
    <span className="inline-flex max-w-[280px] items-center overflow-hidden rounded-md border border-border/60 bg-muted/60 px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
      <span className="min-w-0 truncate">{argsPreview}</span>
    </span>
  ) : undefined;

  const expandedContent =
    rawArgs || skillPath ? (
      <div className="space-y-3 text-sm">
        {skillName && (
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              Skill
            </div>
            <code className="inline-flex max-w-full rounded bg-muted px-2 py-1 font-mono text-xs text-foreground">
              /{skillName}
            </code>
          </div>
        )}

        {rawArgs && (
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              Arguments
            </div>
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-xs text-foreground">
              {rawArgs}
            </pre>
          </div>
        )}

        {skillPath && (
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              Skill directory
            </div>
            <code className="break-all text-sm text-foreground">
              {skillPath}
            </code>
          </div>
        )}
      </div>
    ) : undefined;

  return (
    <ToolLayout
      name="Skill"
      summary={skillName ? `/${skillName}` : "..."}
      summaryClassName="font-mono text-foreground"
      meta={meta}
      state={mergedState}
      nameClassName={mergedState.error ? "text-red-500" : undefined}
      expandedContent={expandedContent}
      onApprove={onApprove}
      onDeny={onDeny}
    />
  );
}
