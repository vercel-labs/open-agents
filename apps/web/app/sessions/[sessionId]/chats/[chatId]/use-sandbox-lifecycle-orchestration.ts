import { useEffect, useRef } from "react";

type SandboxInfo = {
  createdAt: number;
  timeout: number | null;
};

type ReconnectionStatus =
  | "idle"
  | "checking"
  | "connected"
  | "failed"
  | "no_sandbox";

type SyncMode = "normal" | "force";

type UseSandboxLifecycleOrchestrationArgs = {
  isArchived: boolean;
  hasSnapshot: boolean;
  hasRuntimeSandboxState: boolean;
  hasSessionSandboxState: boolean;
  sandboxInfo: SandboxInfo | null;
  isCreatingSandbox: boolean;
  isRestoringSnapshot: boolean;
  reconnectionStatus: ReconnectionStatus;
  attemptReconnection: () => Promise<ReconnectionStatus>;
  handleRestoreSnapshot: () => Promise<void>;
  ensureSandboxReady: () => Promise<boolean>;
  requestStatusSync: (mode?: SyncMode) => Promise<void>;
};

export function useSandboxLifecycleOrchestration({
  isArchived,
  hasSnapshot,
  hasRuntimeSandboxState,
  hasSessionSandboxState,
  sandboxInfo,
  isCreatingSandbox,
  isRestoringSnapshot,
  reconnectionStatus,
  attemptReconnection,
  handleRestoreSnapshot,
  ensureSandboxReady,
  requestStatusSync,
}: UseSandboxLifecycleOrchestrationArgs): void {
  // Track whether we've auto-attempted sandbox startup for this page load.
  const hasAutoStartedSandboxRef = useRef(false);
  const hasAutoRestoredSnapshotRef = useRef(false);
  const shouldAutoResumeOnEntryRef = useRef(true);

  // Attempt a single reconnect probe on entry to pick up authoritative server state
  // (connected sandbox, no sandbox, and snapshot availability).
  // Skip for archived sessions -- they should never spin up a sandbox.
  useEffect(() => {
    if (isArchived) return;
    if (
      !sandboxInfo &&
      !isCreatingSandbox &&
      !isRestoringSnapshot &&
      reconnectionStatus === "idle"
    ) {
      void attemptReconnection();
    }
  }, [
    isArchived,
    sandboxInfo,
    isCreatingSandbox,
    isRestoringSnapshot,
    reconnectionStatus,
    attemptReconnection,
  ]);

  // Auto-resume is only for entering an already-paused session.
  // Once this tab has had an active connection, do not auto-resume again.
  useEffect(() => {
    if (sandboxInfo || reconnectionStatus === "connected") {
      shouldAutoResumeOnEntryRef.current = false;
    }
  }, [sandboxInfo, reconnectionStatus]);

  // Auto-resume paused sessions on entry once we know there is no active runtime sandbox.
  // Skip for archived sessions.
  useEffect(() => {
    if (isArchived) return;
    if (!hasSnapshot) {
      hasAutoRestoredSnapshotRef.current = false;
      return;
    }
    if (!shouldAutoResumeOnEntryRef.current) return;
    if (sandboxInfo || isCreatingSandbox || isRestoringSnapshot) return;
    if (reconnectionStatus === "checking") return;
    if (hasRuntimeSandboxState && reconnectionStatus !== "no_sandbox") return;
    if (hasAutoRestoredSnapshotRef.current) return;

    hasAutoRestoredSnapshotRef.current = true;
    shouldAutoResumeOnEntryRef.current = false;
    void handleRestoreSnapshot();
  }, [
    isArchived,
    hasSnapshot,
    sandboxInfo,
    isCreatingSandbox,
    isRestoringSnapshot,
    hasRuntimeSandboxState,
    reconnectionStatus,
    handleRestoreSnapshot,
  ]);

  // Server-authoritative lifecycle state: lightweight status poll every 15s.
  useEffect(() => {
    if (isCreatingSandbox || isRestoringSnapshot) return;

    const poll = () => {
      if (reconnectionStatus === "checking") return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }
      void requestStatusSync("normal");
    };

    poll();
    const interval = setInterval(poll, 15_000);
    return () => clearInterval(interval);
  }, [
    isCreatingSandbox,
    isRestoringSnapshot,
    reconnectionStatus,
    requestStatusSync,
  ]);

  // Auto-create sandbox right away for new sessions/chats.
  // Skip for archived sessions.
  useEffect(() => {
    if (isArchived) return;
    if (sandboxInfo || isCreatingSandbox || isRestoringSnapshot) return;

    // If we have stored sandbox state, wait for reconnect attempt first.
    if (hasSessionSandboxState && reconnectionStatus === "idle") return;
    if (hasSessionSandboxState && reconnectionStatus === "checking") return;
    if (hasSessionSandboxState && reconnectionStatus === "connected") {
      hasAutoStartedSandboxRef.current = true;
      return;
    }

    // Snapshotted sessions are resumed by the auto-restore-on-entry effect.
    if (hasSnapshot) {
      return;
    }

    if (hasAutoStartedSandboxRef.current) return;
    hasAutoStartedSandboxRef.current = true;

    void ensureSandboxReady();
  }, [
    isArchived,
    hasSessionSandboxState,
    hasSnapshot,
    reconnectionStatus,
    sandboxInfo,
    isCreatingSandbox,
    isRestoringSnapshot,
    ensureSandboxReady,
  ]);
}
