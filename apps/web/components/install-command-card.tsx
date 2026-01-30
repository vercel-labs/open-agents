"use client";

import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import installerConfig from "../../../installer.config.json";

const installUrl = `https://${installerConfig.installDomain}${installerConfig.installPath}`;
const installCommand = `curl -fsSL ${installUrl} | bash`;
interface InstallCommandCardProps {
  title?: string;
  description?: string;
  className?: string;
  variant?: "card" | "inline";
}

export function InstallCommandCard({
  title = "Install the CLI",
  description,
  className,
  variant = "card",
}: InstallCommandCardProps) {
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

  if (variant === "inline") {
    return (
      <div
        className={cn(
          "group/cmd flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 p-1 pl-4 font-mono text-sm transition-colors hover:border-border hover:bg-muted/50",
          className,
        )}
      >
        <code className="flex-1 truncate text-foreground/80">
          curl -fsSL {installUrl} | bash
        </code>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={handleCopy}
          className="shrink-0 opacity-60 transition-opacity hover:opacity-100"
          aria-label="Copy install command"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          <span className="sr-only">Copy install command</span>
        </Button>
      </div>
    );
  }

  return (
    <Card
      className={cn(
        "w-full overflow-hidden border-border/60 bg-background/80 text-left shadow-sm backdrop-blur",
        className,
      )}
    >
      <CardHeader className="gap-2">
        <CardTitle className="text-base font-semibold text-foreground">
          {title}
        </CardTitle>
        {description ? (
          <CardDescription className="text-sm text-muted-foreground">
            {description}
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex items-center justify-between gap-4">
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
      </CardContent>
    </Card>
  );
}
