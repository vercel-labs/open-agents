"use client";

import { useCallback, useEffect, useState } from "react";
import type { CodeEditorLaunchResponse } from "@/app/api/sessions/[sessionId]/code-editor/route";

export type CodeEditorState =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "error"; message: string }
  | { status: "ready"; info: CodeEditorLaunchResponse };

export interface CodeEditorControls {
  state: CodeEditorState;
  menuLabel: string;
  menuDetail: string | null;
  handleOpen: () => Promise<void>;
}

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
}: {
  sessionId: string;
  canRun: boolean;
}): CodeEditorControls {
  const [state, setState] = useState<CodeEditorState>({ status: "idle" });

  useEffect(() => {
    setState({ status: "idle" });
  }, [sessionId]);

  useEffect(() => {
    if (!canRun) {
      setState({ status: "idle" });
    }
  }, [canRun]);

  const openEditorUrl = useCallback((url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const handleOpen = useCallback(async () => {
    if (state.status === "ready") {
      openEditorUrl(state.info.url);
      return;
    }

    if (state.status === "starting") {
      return;
    }

    setState({ status: "starting" });

    try {
      const response = await fetch(`/api/sessions/${sessionId}/code-editor`, {
        method: "POST",
      });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(getErrorMessage(body, "Failed to launch code editor"));
      }

      const launchResponse = parseLaunchResponse(body);
      if (!launchResponse) {
        throw new Error("Invalid code editor response");
      }

      setState({
        status: "ready",
        info: launchResponse,
      });

      openEditorUrl(launchResponse.url);
    } catch (error) {
      console.error("Failed to launch code editor:", error);
      setState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to launch code editor",
      });
    }
  }, [openEditorUrl, sessionId, state]);

  const menuLabel =
    state.status === "ready"
      ? "Open Editor"
      : state.status === "starting"
        ? "Starting Editor..."
        : state.status === "error"
          ? "Retry Editor"
          : "Open Editor";

  const menuDetail =
    state.status === "ready"
      ? state.info.url
      : state.status === "error"
        ? state.message
        : null;

  return {
    state,
    menuLabel,
    menuDetail,
    handleOpen,
  } as const;
}
