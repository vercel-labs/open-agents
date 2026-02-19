"use client";

import { createContext, useContext } from "react";

type SessionLayoutContextValue = {
  openMobileSidebar: () => void;
};

export const SessionLayoutContext = createContext<
  SessionLayoutContextValue | undefined
>(undefined);

export function useSessionLayout() {
  const context = useContext(SessionLayoutContext);
  if (!context) {
    throw new Error(
      "useSessionLayout must be used within a SessionLayoutShell",
    );
  }
  return context;
}
