"use client";

import { toRelativePath } from "@open-harness/shared";
import type { ToolRendererProps } from "@/app/lib/render-tool";
import { DEFAULT_WORKING_DIRECTORY } from "@/lib/sandbox/config";
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
  const skillPath = getDisplayString(output?.skillPath);
  const displaySkillPath = skillPath
    ? toRelativePath(skillPath, DEFAULT_WORKING_DIRECTORY)
    : undefined;
  const outputError =
    output?.success === false ? (output?.error ?? "Skill failed") : undefined;

  const mergedState = outputError
    ? { ...state, error: state.error ?? outputError }
    : state;

  const expandedContent =
    rawArgs || displaySkillPath ? (
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

        {displaySkillPath && (
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              Location
            </div>
            <code className="break-all text-sm text-foreground">
              {displaySkillPath}
            </code>
          </div>
        )}
      </div>
    ) : undefined;

  return (
    <ToolLayout
      name="Skill"
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
