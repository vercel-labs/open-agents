"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr";

export interface CliToken {
  id: string;
  deviceName: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  expiresAt: Date | null;
}

interface TokensResponse {
  tokens: CliToken[];
}

export function useCliTokens() {
  const { data, error, isLoading, mutate } = useSWR<TokensResponse>(
    "/api/settings/tokens",
    fetcher,
  );

  const tokens = data?.tokens ?? [];

  const renameToken = async (tokenId: string, deviceName: string) => {
    // Optimistically update the cache
    await mutate(
      (current) => ({
        tokens: (current?.tokens ?? []).map((t) =>
          t.id === tokenId ? { ...t, deviceName } : t,
        ),
      }),
      { revalidate: false },
    );

    try {
      const res = await fetch(`/api/settings/tokens/${tokenId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceName }),
      });

      if (!res.ok) {
        const errorData = (await res.json()) as { error?: string };
        throw new Error(errorData.error ?? "Failed to rename token");
      }
    } catch (error) {
      // Revalidate to restore server state on error
      await mutate();
      throw error;
    }
  };

  const revokeToken = async (tokenId: string) => {
    // Optimistically update the cache
    await mutate(
      (current) => ({
        tokens: (current?.tokens ?? []).filter((t) => t.id !== tokenId),
      }),
      { revalidate: false },
    );

    try {
      const res = await fetch(`/api/settings/tokens/${tokenId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const errorData = (await res.json()) as { error?: string };
        throw new Error(errorData.error ?? "Failed to revoke token");
      }
    } catch (error) {
      // Revalidate to restore server state on error
      await mutate();
      throw error;
    }
  };

  const revokeAllTokens = async () => {
    // Optimistically clear all tokens from cache
    const previousData = data;
    await mutate({ tokens: [] }, { revalidate: false });

    try {
      const res = await fetch("/api/settings/tokens", {
        method: "DELETE",
      });

      if (!res.ok) {
        const errorData = (await res.json()) as { error?: string };
        throw new Error(errorData.error ?? "Failed to revoke all tokens");
      }
    } catch (error) {
      // Restore previous state on error
      if (previousData) {
        await mutate(previousData, { revalidate: false });
      } else {
        await mutate();
      }
      throw error;
    }
  };

  return {
    tokens,
    loading: isLoading,
    error: error?.message ?? null,
    renameToken,
    revokeToken,
    revokeAllTokens,
    refreshTokens: mutate,
  };
}
