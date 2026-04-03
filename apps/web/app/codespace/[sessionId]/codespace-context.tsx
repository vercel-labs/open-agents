"use client";

import { createContext, useContext, type ReactNode } from "react";

type CodespaceContextValue = {
  sessionTitle: string;
};

const CodespaceContext = createContext<CodespaceContextValue | undefined>(
  undefined,
);

export function useCodespaceContext() {
  const ctx = useContext(CodespaceContext);
  if (!ctx) {
    throw new Error(
      "useCodespaceContext must be used within a CodespaceProvider",
    );
  }
  return ctx;
}

export function CodespaceProvider({
  sessionTitle,
  children,
}: {
  sessionTitle: string;
  children: ReactNode;
}) {
  return (
    <CodespaceContext.Provider value={{ sessionTitle }}>
      {children}
    </CodespaceContext.Provider>
  );
}
