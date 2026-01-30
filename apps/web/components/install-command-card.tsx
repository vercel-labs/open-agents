"use client";

import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import installerConfig from "../../../installer.config.json";

const installUrl = `https://${installerConfig.installDomain}${installerConfig.installPath}`;
const installCommand = `curl -fsSL ${installUrl} | bash`;
export function InstallCommandCard() {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(installCommand);
      setCopied(true);

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        setCopied(false);
      }, 1800);
    } catch (error) {
      console.error(
        "Failed to copy install command:",
        error instanceof Error ? error.message : error,
      );
    }
  }, []);

  return (
    <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border/60 bg-background/80 px-6 py-5 text-left shadow-sm backdrop-blur">
      <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
        Install via curl
      </div>
      <div className="mt-3 flex items-center justify-between gap-4">
        <code className="w-full break-all rounded-lg bg-muted/50 px-4 py-3 font-mono text-sm text-foreground">
          curl -fsSL {installUrl} | bash
        </code>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={handleCopy}
          aria-label="Copy install command"
        >
          {copied ? <Check /> : <Copy />}
          <span className="sr-only">Copy install command</span>
        </Button>
      </div>
    </div>
  );
}
