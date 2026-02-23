"use client";

import { useCallback, useState } from "react";

const STORAGE_KEY = "openharness-last-repo:v1";

export interface LastRepo {
  owner: string;
  repo: string;
  branch?: string;
}

function readLastRepo(): LastRepo | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.owner === "string" &&
      typeof parsed.repo === "string" &&
      parsed.owner &&
      parsed.repo
    ) {
      return {
        owner: parsed.owner,
        repo: parsed.repo,
        branch: typeof parsed.branch === "string" ? parsed.branch : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function useLastRepo() {
  const [lastRepo, setLastRepo] = useState<LastRepo | null>(readLastRepo);

  const saveLastRepo = useCallback((repo: LastRepo) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(repo));
      setLastRepo(repo);
    } catch {
      // localStorage may be unavailable (e.g. private browsing quota exceeded)
    }
  }, []);

  return { lastRepo, saveLastRepo };
}
