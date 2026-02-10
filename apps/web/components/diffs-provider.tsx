"use client";

import { WorkerPoolContextProvider } from "@pierre/diffs/react";

export function DiffsProvider({ children }: { children: React.ReactNode }) {
  return (
    <WorkerPoolContextProvider
      poolOptions={{
        poolSize: 2,
        workerFactory: () =>
          new Worker(
            new URL("@pierre/diffs/worker/worker.js", import.meta.url),
          ),
      }}
      highlighterOptions={{
        theme: "github-dark",
        langs: [],
      }}
    >
      {children}
    </WorkerPoolContextProvider>
  );
}
