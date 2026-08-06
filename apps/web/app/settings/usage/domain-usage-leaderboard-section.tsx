import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatTokens } from "@open-agents/shared";
import type { UsageDomainLeaderboard } from "@/lib/usage/types";

interface DomainUsageLeaderboardSectionProps {
  leaderboard: UsageDomainLeaderboard;
}

function displayModelId(modelId: string | null): string {
  if (!modelId) {
    return "Unknown";
  }

  const slashIndex = modelId.indexOf("/");
  return slashIndex >= 0 ? modelId.slice(slashIndex + 1) : modelId;
}

export function DomainUsageLeaderboardSection({
  leaderboard,
}: DomainUsageLeaderboardSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Internal leaderboard</CardTitle>
        <CardDescription>
          Ranked by total tokens for users with @{leaderboard.domain} in the
          current range.
        </CardDescription>
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
                {leaderboard.rows.map((row, index) => (
                  <TableRow key={row.userId}>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {index + 1}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <div className="min-w-0">
                        <div className="font-medium">
                          {row.name?.trim() || row.username}
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
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
