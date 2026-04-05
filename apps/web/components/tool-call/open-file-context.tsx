"use client";

import { createContext, useContext, type ReactNode } from "react";

type OpenFileCallback = (filePath: string) => void;

const OpenFileContext = createContext<OpenFileCallback | null>(null);

export function OpenFileProvider({
  onOpenFile,
  children,
}: {
  onOpenFile: OpenFileCallback;
  children: ReactNode;
}) {
  return (
    <OpenFileContext.Provider value={onOpenFile}>
      {children}
    </OpenFileContext.Provider>
  );
}

export function useOpenFile(): OpenFileCallback | null {
  return useContext(OpenFileContext);
}
