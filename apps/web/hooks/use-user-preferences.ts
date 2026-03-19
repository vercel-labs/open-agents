"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import type { SandboxType } from "@/components/sandbox-selector-compact";
import type { ModelVariant } from "@/lib/model-variants";

export type DiffMode = "unified" | "split";

export interface UserPreferences {
  defaultModelId: string;
  defaultSubagentModelId: string | null;
  defaultSandboxType: SandboxType;
  defaultDiffMode: DiffMode;
  autoCommitPush: boolean;
  modelVariants: ModelVariant[];
}

interface PreferencesResponse {
  preferences: UserPreferences;
}

export function useUserPreferences() {
  const { data, error, isLoading, mutate } = useSWR<PreferencesResponse>(
    "/api/settings/preferences",
    fetcher,
  );

  const preferences = data?.preferences;

  const updatePreferences = async (
    updates: Partial<UserPreferences>,
  ): Promise<UserPreferences> => {
    const res = await fetch("/api/settings/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });

    if (!res.ok) {
      const errorData = (await res.json()) as { error?: string };
      throw new Error(errorData.error ?? "Failed to update preferences");
    }

    const responseData = (await res.json()) as PreferencesResponse;
    // Optimistically update the cache
    mutate({ preferences: responseData.preferences }, { revalidate: false });
    return responseData.preferences;
  };

  return {
    preferences,
    loading: isLoading,
    error: error?.message ?? null,
    updatePreferences,
    refreshPreferences: mutate,
  };
}
