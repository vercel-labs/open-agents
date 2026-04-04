"use client";

import { ArrowLeft, CodeXml, Loader2, RefreshCw, Square } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { CodeEditorStatusResponse } from "@/app/api/sessions/[sessionId]/code-editor/route";
import { useCodespaceContext } from "./codespace-context";

type EditorState =
  | { status: "loading" }
  | { status: "starting" }
  | { status: "ready"; url: string; port: number }
  | { status: "error"; message: string }
  | { status: "stopping"; url: string; port: number };

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
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const startedRef = useRef(false);

  const startOrCheckEditor = useCallback(async () => {
    try {
      // First check if already running
      const statusRes = await fetch(`/api/sessions/${sessionId}/code-editor`);
      if (statusRes.ok) {
        const statusBody = (await statusRes.json()) as CodeEditorStatusResponse;
        if (statusBody.running && statusBody.url) {
          setState({
            status: "ready",
            url: statusBody.url,
            port: statusBody.port,
          });
          return;
        }
      }

      // Not running, start it
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

      if (
        !isRecord(launchBody) ||
        typeof launchBody.url !== "string" ||
        typeof launchBody.port !== "number"
      ) {
        throw new Error("Invalid code editor response");
      }

      setState({
        status: "ready",
        url: launchBody.url as string,
        port: launchBody.port as number,
      });
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
    setState({ status: "stopping", url: state.url, port: state.port });

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
    setIframeLoaded(false);
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
        {state.status === "error" && (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <p className="text-sm text-destructive">{state.message}</p>
            <Button variant="outline" size="sm" onClick={handleRetry}>
              <RefreshCw className="mr-1.5 h-4 w-4" />
              Try Again
            </Button>
          </div>
        )}

        {/* oxlint-disable react/iframe-missing-sandbox -- code-server requires both allow-scripts and allow-same-origin; cross-origin so the combination is safe */}
        {(state.status === "ready" || state.status === "stopping") && (
          <iframe
            ref={iframeRef}
            src={state.url}
            title="Code Editor"
            className="h-full w-full border-0"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals"
            allow="clipboard-read; clipboard-write"
            onLoad={() => setIframeLoaded(true)}
          />
        )}
        {/* oxlint-enable react/iframe-missing-sandbox */}

        {/* Loading overlay — shown while the API is working or while the iframe content is loading */}
        {state.status !== "error" &&
          (state.status === "loading" ||
            state.status === "starting" ||
            !iframeLoaded) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-sm">
                {state.status === "loading"
                  ? "Checking editor status..."
                  : state.status === "starting"
                    ? "Starting code editor..."
                    : "Loading editor..."}
              </p>
            </div>
          )}
      </div>
    </div>
  );
}
