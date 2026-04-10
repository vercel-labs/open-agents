"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";

export type GitPanelTab = "diff" | "pr";
export type ActiveView = "chat" | "diff";
export type DiffScope = "uncommitted" | "branch";

type GitPanelContextValue = {
  /** Whether the right git panel is open */
  gitPanelOpen: boolean;
  setGitPanelOpen: (open: boolean) => void;
  toggleGitPanel: () => void;

  /** Active tab within the git panel */
  gitPanelTab: GitPanelTab;
  setGitPanelTab: (tab: GitPanelTab) => void;

  /** Active view in the main content area (chat messages vs diff) */
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;

  /** Whether the user has explicitly closed the Changes tab */
  changesTabDismissed: boolean;
  setChangesTabDismissed: (dismissed: boolean) => void;

  /** File path to scroll to in the diff tab view */
  focusedDiffFile: string | null;
  setFocusedDiffFile: (file: string | null) => void;
  focusedDiffRequestId: number;

  /** Open the diff tab in the main content area, optionally focused on a file */
  openDiffToFile: (filePath: string) => void;

  /** Diff scope: "uncommitted" = uncommitted only, "branch" = all changes vs base */
  diffScope: DiffScope;
  setDiffScope: (scope: DiffScope) => void;

  /** Whether there are uncommitted changes that need attention */
  hasActionNeeded: boolean;
  setHasActionNeeded: (needed: boolean) => void;

  /** Number of changed files (for badge display on toggle button) */
  changesCount: number;
  setChangesCount: (count: number) => void;

  /** Whether there are committed (pushed) changes on the branch */
  hasCommittedChanges: boolean;
  setHasCommittedChanges: (has: boolean) => void;

  /** Share dialog trigger (set by per-chat page, called by header) */
  shareRequested: boolean;
  setShareRequested: (requested: boolean) => void;

  /** Ref to the DOM node where the git panel should be portaled into */
  panelPortalRef: RefObject<HTMLDivElement | null>;

  /** Ref to the DOM node where header action buttons should be portaled into */
  headerActionsRef: RefObject<HTMLDivElement | null>;
};

const GitPanelContext = createContext<GitPanelContextValue | undefined>(
  undefined,
);

export function GitPanelProvider({ children }: { children: ReactNode }) {
  const [gitPanelOpen, setGitPanelOpen] = useState(false);
  const [gitPanelTab, setGitPanelTab] = useState<GitPanelTab>("diff");
  const [activeView, setActiveView] = useState<ActiveView>("chat");
  const [focusedDiffFile, setFocusedDiffFile] = useState<string | null>(null);
  const [focusedDiffRequestId, setFocusedDiffRequestId] = useState(0);
  const [changesTabDismissed, setChangesTabDismissed] = useState(false);
  const [diffScope, setDiffScope] = useState<DiffScope>("uncommitted");
  const [hasActionNeeded, setHasActionNeeded] = useState(false);
  const [changesCount, setChangesCount] = useState(0);
  const [hasCommittedChanges, setHasCommittedChanges] = useState(false);
  const [shareRequested, setShareRequested] = useState(false);
  const panelPortalRef = useRef<HTMLDivElement | null>(null);
  const headerActionsRef = useRef<HTMLDivElement | null>(null);

  const toggleGitPanel = useCallback(() => {
    setGitPanelOpen((prev) => !prev);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isGitPanelShortcut =
        event.code === "KeyB" &&
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        !event.altKey;

      if (!isGitPanelShortcut || event.repeat) {
        return;
      }

      event.preventDefault();
      toggleGitPanel();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleGitPanel]);

  const openDiffToFile = useCallback((filePath: string) => {
    setFocusedDiffFile(filePath);
    setFocusedDiffRequestId((prev) => prev + 1);
    setActiveView("diff");
    setChangesTabDismissed(false);
  }, []);

  const value = useMemo(
    () => ({
      gitPanelOpen,
      setGitPanelOpen,
      toggleGitPanel,
      gitPanelTab,
      setGitPanelTab,
      activeView,
      setActiveView,
      changesTabDismissed,
      setChangesTabDismissed,
      focusedDiffFile,
      setFocusedDiffFile,
      focusedDiffRequestId,
      openDiffToFile,
      diffScope,
      setDiffScope,
      hasActionNeeded,
      setHasActionNeeded,
      changesCount,
      setChangesCount,
      hasCommittedChanges,
      setHasCommittedChanges,
      shareRequested,
      setShareRequested,
      panelPortalRef,
      headerActionsRef,
    }),
    [
      gitPanelOpen,
      toggleGitPanel,
      gitPanelTab,
      activeView,
      changesTabDismissed,
      focusedDiffFile,
      focusedDiffRequestId,
      openDiffToFile,
      diffScope,
      hasActionNeeded,
      changesCount,
      hasCommittedChanges,
      shareRequested,
    ],
  );

  return (
    <GitPanelContext.Provider value={value}>
      {children}
    </GitPanelContext.Provider>
  );
}

export function useGitPanel() {
  const context = useContext(GitPanelContext);
  if (!context) {
    throw new Error("useGitPanel must be used within a GitPanelProvider");
  }
  return context;
}
