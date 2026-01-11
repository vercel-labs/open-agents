"use client";

import { useState, useEffect } from "react";
import type { SessionUserInfo } from "@/lib/session/types";

export function useSession() {
  const [session, setSession] = useState<SessionUserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSession = async () => {
      try {
        const res = await fetch("/api/auth/info");
        const data = (await res.json()) as SessionUserInfo;
        setSession(data);
      } catch (error) {
        console.error("Failed to fetch session:", error);
        setSession({ user: undefined });
      } finally {
        setLoading(false);
      }
    };

    fetchSession();

    const handleFocus = () => fetchSession();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  return { session, loading, isAuthenticated: !!session?.user };
}
