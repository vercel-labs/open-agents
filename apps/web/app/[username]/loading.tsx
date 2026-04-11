import { Loader2 } from "lucide-react";

const PRESET_WIDTHS = ["w-16", "w-10", "w-10", "w-10"];
const LIST_ROW_WIDTHS = ["w-24", "w-20", "w-28", "w-16", "w-24"];
const GRID_COLUMNS = Array.from({ length: 26 });
const GRID_ROWS = Array.from({ length: 7 });

function ShimmerBlock({ className }: { className: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-muted/70 ${className}`}
      aria-hidden="true"
    />
  );
}

export default function PublicUsageLoading() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-6 py-8 sm:py-12">
        <div className="flex items-center justify-between gap-4">
          <ShimmerBlock className="h-8 w-24" />
          <div className="flex gap-1">
            {PRESET_WIDTHS.map((width, index) => (
              <ShimmerBlock
                key={`${width}-${index}`}
                className={`h-8 rounded-md ${width}`}
              />
            ))}
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-8 lg:flex-row lg:gap-10">
          <div className="w-full shrink-0 lg:w-56">
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <ShimmerBlock className="h-4 w-28" />
                  <ShimmerBlock className="h-4 w-20" />
                </div>
              </div>

              <div className="space-y-3">
                <ShimmerBlock className="h-3 w-32" />
                <div className="rounded-lg border border-border/50 bg-muted/10 px-4 py-1">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div
                      key={index}
                      className={`flex items-center justify-between gap-4 py-3 ${
                        index < 2 ? "border-b border-border/50" : ""
                      }`}
                    >
                      <ShimmerBlock className="h-4 w-20" />
                      <ShimmerBlock className="h-4 w-16" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="min-w-0 flex-1 space-y-8">
            <div>
              <ShimmerBlock className="mb-3 h-4 w-16" />
              <div className="overflow-hidden rounded-xl border border-border/50 bg-muted/10 p-4">
                <div
                  className="grid gap-1.5"
                  style={{ gridTemplateColumns: "repeat(26, minmax(0, 1fr))" }}
                >
                  {GRID_COLUMNS.flatMap((_, columnIndex) =>
                    GRID_ROWS.map((_, rowIndex) => (
                      <div
                        key={`${columnIndex}-${rowIndex}`}
                        className="aspect-square animate-pulse rounded-[3px] bg-muted/70"
                      />
                    )),
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-8 sm:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="space-y-2.5">
                  <ShimmerBlock className="h-4 w-20" />
                  <div className="space-y-1.5">
                    {LIST_ROW_WIDTHS.map((width, rowIndex) => (
                      <div
                        key={`${index}-${rowIndex}`}
                        className="flex items-center gap-2.5"
                      >
                        <div className="h-2 w-2 rounded-full bg-muted/70" />
                        <ShimmerBlock className={`h-4 ${width}`} />
                        <ShimmerBlock className="ml-auto h-3 w-10" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-6">
              <ShimmerBlock className="h-4 w-36" />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={index}
                    className="space-y-2 rounded-lg border border-border/50 bg-muted/10 px-4 py-3"
                  >
                    <ShimmerBlock className="h-3 w-20" />
                    <ShimmerBlock className="h-7 w-24" />
                    <ShimmerBlock className="h-3 w-28" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
