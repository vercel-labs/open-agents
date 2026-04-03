"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSession } from "@/hooks/use-session";
import { fetcher } from "@/lib/swr";
import { formatDateOnly } from "@/lib/usage/date-range";
import type { UsageDomainLeaderboard } from "@/lib/usage/types";

type LeaderboardRange = "today" | "week" | "all";

interface UsageResponse {
  domainLeaderboard: UsageDomainLeaderboard | null;
}

const RANGE_OPTIONS: { value: LeaderboardRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "7 days" },
  { value: "all", label: "All time" },
];

function buildUsagePath(range: LeaderboardRange): string {
  if (range === "all") {
    return "/api/usage";
  }

  const now = new Date();
  const to = formatDateOnly(now);

  let fromDate: Date;
  if (range === "today") {
    fromDate = now;
  } else {
    fromDate = new Date(now);
    fromDate.setDate(now.getDate() - 6);
  }

  const query = new URLSearchParams({ from: formatDateOnly(fromDate), to });
  return `/api/usage?${query.toString()}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function displayModelId(modelId: string | null): string {
  if (!modelId) {
    return "Unknown";
  }

  const slashIndex = modelId.indexOf("/");
  return slashIndex >= 0 ? modelId.slice(slashIndex + 1) : modelId;
}

export function LeaderboardSectionSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Internal leaderboard</CardTitle>
        <CardDescription>
          <Skeleton className="h-4 w-64" />
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}

function RangeFilter({
  value,
  onChange,
}: {
  value: LeaderboardRange;
  onChange: (next: LeaderboardRange) => void;
}) {
  return (
    <div className="flex w-fit gap-1 rounded-lg bg-muted p-1">
      {RANGE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            value === option.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function LeaderboardSection() {
  const { session } = useSession();
  const userId = session?.user?.id;
  const [range, setRange] = useState<LeaderboardRange>("today");

  const usagePath = useMemo(() => buildUsagePath(range), [range]);

  const { data, isLoading, error } = useSWR<UsageResponse>(usagePath, fetcher);

  const leaderboard = data?.domainLeaderboard ?? null;

  const currentUserRank = useMemo(() => {
    if (!leaderboard || !userId) return null;
    const index = leaderboard.rows.findIndex((row) => row.userId === userId);
    return index >= 0 ? index + 1 : null;
  }, [leaderboard, userId]);

  if (isLoading) return <LeaderboardSectionSkeleton />;

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Internal leaderboard</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Failed to load leaderboard data.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!leaderboard) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Internal leaderboard</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The internal leaderboard is available for users with a verified
            organization email domain.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <CardTitle>Internal leaderboard</CardTitle>
            <CardDescription>
              Ranked by total tokens for users with @{leaderboard.domain}.
            </CardDescription>
          </div>
          <RangeFilter value={range} onChange={setRange} />
        </div>
        {currentUserRank ? (
          <div className="text-sm text-muted-foreground">
            Your rank:{" "}
            <span className="font-semibold tabular-nums text-foreground">
              #{currentUserRank}
            </span>{" "}
            of {leaderboard.rows.length}
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        {leaderboard.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No matching usage in this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead className="text-right">Total tokens</TableHead>
                  <TableHead className="hidden sm:table-cell">
                    Most used model
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leaderboard.rows.map((row, index) => {
                  const isCurrentUser = row.userId === userId;
                  return (
                    <TableRow
                      key={row.userId}
                      className={isCurrentUser ? "bg-muted/50" : undefined}
                    >
                      <TableCell className="text-muted-foreground tabular-nums">
                        {index + 1}
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <div className="min-w-0">
                          <div className="font-medium">
                            {row.name?.trim() || row.username}
                            {isCurrentUser ? (
                              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                                (you)
                              </span>
                            ) : null}
                          </div>
                          {row.name?.trim() ? (
                            <div className="text-xs text-muted-foreground">
                              @{row.username}
                            </div>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatTokens(row.totalTokens)}
                      </TableCell>
                      <TableCell className="hidden whitespace-normal sm:table-cell">
                        <div className="font-medium">
                          {displayModelId(row.mostUsedModelId)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatTokens(row.mostUsedModelTokens)} tokens
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
