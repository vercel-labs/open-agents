"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CodeEditorLaunchResponse,
  CodeEditorStatusResponse,
} from "@/app/api/sessions/[sessionId]/code-editor/route";

export type CodeEditorState =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "stopping"; info: CodeEditorLaunchResponse }
  | { status: "error"; message: string }
  | { status: "ready"; info: CodeEditorLaunchResponse };

export interface CodeEditorControls {
  state: CodeEditorState;
  menuLabel: string;
  menuDetail: string | null;
  showStopAction: boolean;
  handleOpen: () => Promise<void>;
  handleOpenFile: (filePath: string) => Promise<void>;
  handleStop: () => Promise<void>;
}

type EnsureSandboxReady = () => Promise<boolean>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorMessage(body: unknown, fallback: string): string {
  if (!isRecord(body) || typeof body.error !== "string") {
    return fallback;
  }

  return body.error;
}

function parseLaunchResponse(body: unknown): CodeEditorLaunchResponse | null {
  if (!isRecord(body)) {
    return null;
  }

  const { url, port } = body;
  if (
    typeof url !== "string" ||
    typeof port !== "number" ||
    !Number.isFinite(port)
  ) {
    return null;
  }

  return { url, port };
}

export function useCodeEditor({
  sessionId,
  canRun,
  ensureSandboxReady,
}: {
  sessionId: string;
  canRun: boolean;
  ensureSandboxReady?: EnsureSandboxReady;
}): CodeEditorControls {
  const router = useRouter();
  const [state, setState] = useState<CodeEditorState>({ status: "idle" });

  useEffect(() => {
    setState({ status: "idle" });
  }, [sessionId]);

  useEffect(() => {
    if (!canRun) {
      setState({ status: "idle" });
    }
  }, [canRun]);

  // Check if code-server is already running on mount / session change
  const hasCheckedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!canRun || hasCheckedRef.current === sessionId) {
      return;
    }
    hasCheckedRef.current = sessionId;

    let cancelled = false;

    async function checkStatus() {
      try {
        const response = await fetch(`/api/sessions/${sessionId}/code-editor`);
        if (!response.ok || cancelled) {
          return;
        }

        const body = (await response.json()) as CodeEditorStatusResponse;
        if (cancelled) {
          return;
        }

        if (body.running && body.url) {
          setState({
            status: "ready",
            info: { url: body.url, port: body.port },
          });
        }
      } catch {
        // Silently ignore — status check is best-effort
      }
    }

    void checkStatus();

    return () => {
      cancelled = true;
    };
  }, [canRun, sessionId]);

  const openEditorPage = useCallback(() => {
    router.push(`/codespace/${sessionId}`);
  }, [router, sessionId]);

  /**
   * Ensure code-server is running and return the launch response.
   * Returns the existing info if already ready, otherwise launches.
   */
  const ensureRunning =
    useCallback(async (): Promise<CodeEditorLaunchResponse | null> => {
      if (state.status === "ready") {
        return state.info;
      }

      if (state.status === "starting" || state.status === "stopping") {
        return null;
      }

      setState({ status: "starting" });

      try {
        const sandboxReady = await ensureSandboxReady?.();
        if (sandboxReady === false) {
          throw new Error("Failed to start sandbox");
        }

        const response = await fetch(`/api/sessions/${sessionId}/code-editor`, {
          method: "POST",
        });
        const body: unknown = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(
            getErrorMessage(body, "Failed to launch code editor"),
          );
        }

        const launchResponse = parseLaunchResponse(body);
        if (!launchResponse) {
          throw new Error("Invalid code editor response");
        }

        setState({
          status: "ready",
          info: launchResponse,
        });

        return launchResponse;
      } catch (error) {
        console.error("Failed to launch code editor:", error);
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Failed to launch code editor",
        });
        return null;
      }
    }, [ensureSandboxReady, sessionId, state]);

  const handleOpen = useCallback(async () => {
    if (state.status === "ready") {
      const sandboxReady = await ensureSandboxReady?.();
      if (sandboxReady === false) {
        setState({ status: "error", message: "Failed to start sandbox" });
        return;
      }

      openEditorPage();
      return;
    }

    const info = await ensureRunning();
    if (info) {
      openEditorPage();
    }
  }, [ensureRunning, ensureSandboxReady, openEditorPage, state]);

  const handleOpenFile = useCallback(
    async (_filePath: string) => {
      if (state.status === "ready") {
        const sandboxReady = await ensureSandboxReady?.();
        if (sandboxReady === false) {
          setState({ status: "error", message: "Failed to start sandbox" });
          return;
        }

        openEditorPage();
        return;
      }

      const info = await ensureRunning();
      if (info) {
        // Open the codespace page; file-specific deep linking can be added
        // to the codespace route later via query parameters.
        openEditorPage();
      }
    },
    [ensureRunning, ensureSandboxReady, openEditorPage, state],
  );

  const handleStop = useCallback(async () => {
    if (state.status !== "ready") {
      return;
    }

    setState({ status: "stopping", info: state.info });

    try {
      const response = await fetch(`/api/sessions/${sessionId}/code-editor`, {
        method: "DELETE",
      });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(getErrorMessage(body, "Failed to stop code editor"));
      }

      setState({ status: "idle" });
    } catch (error) {
      console.error("Failed to stop code editor:", error);
      setState({
        status: "error",
        message:
          error instanceof Error ? error.message : "Failed to stop code editor",
      });
    }
  }, [sessionId, state]);

  const menuLabel =
    state.status === "ready"
      ? "Open Editor"
      : state.status === "starting"
        ? "Starting Editor..."
        : state.status === "stopping"
          ? "Stopping Editor..."
          : state.status === "error"
            ? "Retry Editor"
            : "Open Editor";

  const menuDetail =
    state.status === "ready" || state.status === "stopping"
      ? "Running"
      : state.status === "error"
        ? state.message
        : null;

  const showStopAction =
    canRun && (state.status === "ready" || state.status === "stopping");

  return {
    state,
    menuLabel,
    menuDetail,
    showStopAction,
    handleOpen,
    handleOpenFile,
    handleStop,
  } as const;
}
