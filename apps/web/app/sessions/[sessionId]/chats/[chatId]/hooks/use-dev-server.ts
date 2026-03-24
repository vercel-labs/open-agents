"use client";

import { useCallback, useEffect, useState } from "react";
import type { DevServerLaunchResponse } from "@/app/api/sessions/[sessionId]/dev-server/route";

export type DevServerLaunchState =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "stopping"; info: DevServerLaunchResponse }
  | { status: "error"; message: string }
  | { status: "ready"; info: DevServerLaunchResponse };

export interface DevServerControls {
  state: DevServerLaunchState;
  menuLabel: string;
  menuDetail: string | null;
  showStopAction: boolean;
  handlePrimaryAction: () => Promise<void>;
  handleStopAction: () => Promise<void>;
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

function parseLaunchResponse(body: unknown): DevServerLaunchResponse | null {
  if (!isRecord(body)) {
    return null;
  }

  const { packagePath, port, url } = body;
  if (
    typeof packagePath !== "string" ||
    typeof port !== "number" ||
    !Number.isFinite(port) ||
    typeof url !== "string"
  ) {
    return null;
  }

  return {
    packagePath,
    port,
    url,
  };
}

export function useDevServer({
  sessionId,
  canRun,
}: {
  sessionId: string;
  canRun: boolean;
}): DevServerControls {
  const [state, setState] = useState<DevServerLaunchState>({ status: "idle" });

  useEffect(() => {
    setState({ status: "idle" });
  }, [sessionId]);

  useEffect(() => {
    if (!canRun) {
      setState({ status: "idle" });
    }
  }, [canRun]);

  const openDevServerUrl = useCallback((url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const handlePrimaryAction = useCallback(async () => {
    if (state.status === "ready") {
      openDevServerUrl(state.info.url);
      return;
    }

    if (state.status === "starting" || state.status === "stopping") {
      return;
    }

    setState({ status: "starting" });

    try {
      const response = await fetch(`/api/sessions/${sessionId}/dev-server`, {
        method: "POST",
      });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(getErrorMessage(body, "Failed to launch dev server"));
      }

      const launchResponse = parseLaunchResponse(body);
      if (!launchResponse) {
        throw new Error("Invalid dev server response");
      }

      setState({
        status: "ready",
        info: launchResponse,
      });
    } catch (error) {
      console.error("Failed to launch dev server:", error);
      setState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to launch dev server",
      });
    }
  }, [openDevServerUrl, sessionId, state]);

  const handleStopAction = useCallback(async () => {
    if (state.status !== "ready") {
      return;
    }

    setState({ status: "stopping", info: state.info });

    try {
      const response = await fetch(`/api/sessions/${sessionId}/dev-server`, {
        method: "DELETE",
      });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(getErrorMessage(body, "Failed to stop dev server"));
      }

      setState({ status: "idle" });
    } catch (error) {
      console.error("Failed to stop dev server:", error);
      setState({
        status: "error",
        message:
          error instanceof Error ? error.message : "Failed to stop dev server",
      });
    }
  }, [sessionId, state]);

  const menuLabel =
    state.status === "ready"
      ? state.info.packagePath === "root"
        ? "Open Dev Server"
        : `Open ${state.info.packagePath}`
      : state.status === "starting"
        ? "Starting Dev Server..."
        : state.status === "stopping"
          ? "Stopping Dev Server..."
          : state.status === "error"
            ? "Retry Dev Server"
            : "Run Dev Server";
  const menuDetail =
    state.status === "ready" || state.status === "stopping"
      ? state.info.url
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
    handlePrimaryAction,
    handleStopAction,
  } as const;
}
