"use client";

import useSWR from "swr";
import {
  vercelRepoProjectsResponseSchema,
  type VercelRepoProjectsResponse,
} from "@/lib/vercel/types";

async function fetchVercelRepoProjects(
  url: string,
): Promise<VercelRepoProjectsResponse> {
  const response = await fetch(url);
  const json = (await response.json()) as unknown;

  if (!response.ok) {
    const error =
      json && typeof json === "object" && "error" in json
        ? (json as { error?: unknown }).error
        : undefined;
    throw new Error(
      typeof error === "string" ? error : "Failed to load Vercel projects",
    );
  }

  const parsed = vercelRepoProjectsResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("Received an invalid Vercel projects response");
  }

  return parsed.data;
}

export function useVercelRepoProjects(params: {
  enabled: boolean;
  repoOwner: string;
  repoName: string;
}) {
  const key =
    params.enabled && params.repoOwner && params.repoName
      ? `/api/vercel/repo-projects?${new URLSearchParams({
          repoOwner: params.repoOwner,
          repoName: params.repoName,
        }).toString()}`
      : null;

  const { data, error, isLoading, mutate } = useSWR(
    key,
    fetchVercelRepoProjects,
    {
      revalidateOnFocus: false,
    },
  );

  return {
    data,
    loading: isLoading,
    error: error instanceof Error ? error.message : null,
    refresh: mutate,
  };
}
