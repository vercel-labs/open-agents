"use client";

import { ArrowLeft, CodeXml, Loader2, RefreshCw, Square } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { CodeEditorStatusResponse } from "@/app/api/sessions/[sessionId]/code-editor/route";
import { CODESPACE_PROXY_BASE_PATH } from "@/lib/sandbox/config";
import { useCodespaceContext } from "./codespace-context";

type EditorState =
  | { status: "loading" }
  | { status: "starting" }
  | { status: "ready" }
  | { status: "error"; message: string }
  | { status: "stopping" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorMessage(body: unknown, fallback: string): string {
  if (!isRecord(body) || typeof body.error !== "string") {
    return fallback;
  }
  return body.error;
}

export default function CodespacePage() {
  const router = useRouter();
  const { sessionId } = useParams<{ sessionId: string }>();
  const { sessionTitle } = useCodespaceContext();
  const [state, setState] = useState<EditorState>({ status: "loading" });
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const startedRef = useRef(false);

  const startOrCheckEditor = useCallback(async () => {
    try {
      // First check if already running — the API also sets the proxy cookie
      const statusRes = await fetch(`/api/sessions/${sessionId}/code-editor`);
      if (statusRes.ok) {
        const statusBody = (await statusRes.json()) as CodeEditorStatusResponse;
        if (statusBody.running) {
          setState({ status: "ready" });
          return;
        }
      }

      // Not running, start it — the API sets the proxy cookie on success
      setState({ status: "starting" });
      const launchRes = await fetch(`/api/sessions/${sessionId}/code-editor`, {
        method: "POST",
      });
      const launchBody: unknown = await launchRes.json().catch(() => null);

      if (!launchRes.ok) {
        throw new Error(
          getErrorMessage(launchBody, "Failed to launch code editor"),
        );
      }

      setState({ status: "ready" });
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to launch code editor",
      });
    }
  }, [sessionId]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void startOrCheckEditor();
  }, [startOrCheckEditor]);

  const handleStop = useCallback(async () => {
    if (state.status !== "ready") return;
    setState({ status: "stopping" });

    try {
      const res = await fetch(`/api/sessions/${sessionId}/code-editor`, {
        method: "DELETE",
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(getErrorMessage(body, "Failed to stop code editor"));
      }
      router.back();
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof Error ? error.message : "Failed to stop code editor",
      });
    }
  }, [sessionId, state, router]);

  const handleRetry = useCallback(() => {
    setState({ status: "loading" });
    startedRef.current = false;
    void startOrCheckEditor();
  }, [startOrCheckEditor]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={() => router.back()}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        <div className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
          <CodeXml className="h-4 w-4 shrink-0" />
          <span className="truncate">{sessionTitle}</span>
        </div>

        <div className="flex-1" />

        {state.status === "error" && (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={handleRetry}
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </Button>
        )}

        {(state.status === "ready" || state.status === "stopping") && (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            disabled={state.status === "stopping"}
            onClick={() => void handleStop()}
          >
            {state.status === "stopping" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Square className="h-3.5 w-3.5 fill-current" />
            )}
            {state.status === "stopping" ? "Stopping..." : "Stop Editor"}
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="relative flex-1 overflow-hidden">
        {(state.status === "loading" || state.status === "starting") && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm">
              {state.status === "loading"
                ? "Checking editor status..."
                : "Starting code editor..."}
            </p>
          </div>
        )}

        {state.status === "error" && (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <p className="text-sm text-destructive">{state.message}</p>
            <Button variant="outline" size="sm" onClick={handleRetry}>
              <RefreshCw className="mr-1.5 h-4 w-4" />
              Try Again
            </Button>
          </div>
        )}

        {/* oxlint-disable react/iframe-missing-sandbox -- code-server requires allow-scripts + allow-same-origin to function */}
        {(state.status === "ready" || state.status === "stopping") && (
          <iframe
            ref={iframeRef}
            src={`${CODESPACE_PROXY_BASE_PATH}/`}
            title="Code Editor"
            className="h-full w-full border-0"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals"
            allow="clipboard-read; clipboard-write"
          />
        )}
        {/* oxlint-enable react/iframe-missing-sandbox */}
      </div>
    </div>
  );
}
