"use client";

import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  Loader2Icon,
  XCircleIcon,
} from "lucide-react";
import { useState } from "react";
import type {
  VercelProjectSelection,
  VercelRepoProjectsResponse,
} from "@/lib/vercel/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

const NO_VERCEL_PROJECT_VALUE = "__none__";

function VercelIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 1L24 22H0L12 1Z" />
    </svg>
  );
}

function formatVercelProjectLabel(project: VercelProjectSelection): string {
  return project.teamSlug
    ? `${project.teamSlug} / ${project.projectName}`
    : project.projectName;
}

interface SessionStarterVercelSyncSectionProps {
  controlsDisabled: boolean;
  isVercelLookupPending: boolean;
  repoProjects: VercelRepoProjectsResponse | undefined;
  repoProjectsError: string | null;
  requiresVercelChoice: boolean;
  vercelProjectChoice: string | null | undefined;
  onVercelProjectChoiceChange: (value: string | null) => void;
}

export function SessionStarterVercelSyncSection({
  controlsDisabled,
  isVercelLookupPending,
  repoProjects,
  repoProjectsError,
  requiresVercelChoice,
  vercelProjectChoice,
  onVercelProjectChoiceChange,
}: SessionStarterVercelSyncSectionProps) {
  // Auto-expand when user needs to make a choice
  const [manualExpanded, setManualExpanded] = useState(false);
  const expanded = manualExpanded || requiresVercelChoice;

  const selectedProject =
    typeof vercelProjectChoice === "string"
      ? repoProjects?.projects.find((p) => p.projectId === vercelProjectChoice)
      : null;

  // Determine compact-row content
  const getCompactContent = (): {
    icon: React.ReactNode;
    label: React.ReactNode;
  } | null => {
    if (isVercelLookupPending) {
      return {
        icon: (
          <Loader2Icon className="h-3.5 w-3.5 animate-spin text-muted-foreground/70" />
        ),
        label: (
          <span className="text-xs text-muted-foreground">
            Scanning for linked Vercel projects&hellip;
          </span>
        ),
      };
    }
    if (repoProjectsError) {
      return {
        icon: (
          <AlertCircleIcon className="h-3.5 w-3.5 text-muted-foreground/70" />
        ),
        label: (
          <span className="text-xs text-muted-foreground">
            Could not load Vercel projects
          </span>
        ),
      };
    }
    if (repoProjects?.projects.length === 0) {
      return {
        icon: <XCircleIcon className="h-3.5 w-3.5 text-muted-foreground/50" />,
        label: (
          <span className="text-xs text-muted-foreground">
            No linked Vercel projects &mdash; starting without env sync
          </span>
        ),
      };
    }
    if (selectedProject) {
      return {
        icon: (
          <CheckCircle2Icon className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400/80" />
        ),
        label: (
          <span className="text-xs text-muted-foreground">
            Syncing env from{" "}
            <span className="font-medium text-foreground/80">
              {formatVercelProjectLabel(selectedProject)}
            </span>
          </span>
        ),
      };
    }
    if (vercelProjectChoice === null) {
      return {
        icon: <XCircleIcon className="h-3.5 w-3.5 text-muted-foreground/50" />,
        label: (
          <span className="text-xs text-muted-foreground">
            Env sync disabled for this session
          </span>
        ),
      };
    }
    return null;
  };

  const compact = getCompactContent();

  if (!expanded && compact) {
    return (
      <button
        type="button"
        onClick={() => setManualExpanded(true)}
        className="flex w-full items-center gap-2.5 rounded-lg border border-border/70 bg-muted/20 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/40 dark:border-white/10 dark:bg-white/[0.02] dark:hover:bg-white/[0.04]"
      >
        {compact.icon}
        <span className="min-w-0 flex-1 truncate">{compact.label}</span>
        <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
      </button>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border/70 dark:border-white/10">
      <button
        type="button"
        onClick={() => setManualExpanded(false)}
        className="flex w-full items-start gap-3 bg-muted/30 px-3.5 py-3 text-left transition-colors hover:bg-muted/40 dark:bg-white/[0.025] dark:hover:bg-white/[0.04]"
      >
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background dark:border-white/10 dark:bg-white/[0.06]">
          <VercelIcon className="h-3 w-3" />
        </div>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-sm font-medium leading-snug">Environment sync</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Pull Development env vars into{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px] dark:bg-white/[0.06]">
              .env.local
            </code>{" "}
            when the sandbox is created.
          </p>
        </div>
        {!requiresVercelChoice && (
          <ChevronUpIcon className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/50" />
        )}
      </button>
      <div className="border-t border-border/70 px-3.5 py-3 dark:border-white/10">
        {isVercelLookupPending ? (
          <div className="flex items-center gap-2.5 py-0.5">
            <Loader2Icon className="h-3.5 w-3.5 animate-spin text-muted-foreground/70" />
            <span className="text-xs text-muted-foreground">
              Scanning for linked Vercel projects&hellip;
            </span>
          </div>
        ) : repoProjectsError ? (
          <div className="flex items-start gap-2.5">
            <AlertCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              {repoProjectsError}. Will fall back to any saved repo default.
            </p>
          </div>
        ) : repoProjects?.projects.length === 0 ? (
          <div className="flex items-start gap-2.5">
            <XCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              No linked Vercel projects found for this repo. The session will
              start without env sync.
            </p>
          </div>
        ) : repoProjects ? (
          <div className="space-y-2">
            <Select
              value={
                vercelProjectChoice === null
                  ? NO_VERCEL_PROJECT_VALUE
                  : vercelProjectChoice
              }
              onValueChange={(value) =>
                onVercelProjectChoiceChange(
                  value === NO_VERCEL_PROJECT_VALUE ? null : value,
                )
              }
              disabled={controlsDisabled}
            >
              <SelectTrigger className="w-full bg-background/80 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]">
                <SelectValue placeholder="Select a Vercel project&hellip;" />
              </SelectTrigger>
              <SelectContent align="start">
                {repoProjects.projects.map((project) => (
                  <SelectItem key={project.projectId} value={project.projectId}>
                    {formatVercelProjectLabel(project)}
                  </SelectItem>
                ))}
                <SelectSeparator />
                <SelectItem value={NO_VERCEL_PROJECT_VALUE}>
                  <span className="text-muted-foreground">
                    Don&apos;t sync env variables
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
            {requiresVercelChoice && (
              <p className="text-xs text-amber-600 dark:text-amber-400/80">
                Select a project to sync, or opt out for this session.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
