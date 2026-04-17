"use client";

import { ExternalLink } from "lucide-react";
import { McpProviderIcon } from "@/components/mcp-icons";
import type { PageResult } from "./shared";
import { isValidExternalUrl } from "./shared";

export function PageResultView({ page }: { page: PageResult }) {
  const hasLink = isValidExternalUrl(page.url);

  // Strip XML-like tags for a cleaner preview
  const preview = page.text
    ?.replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 800);

  return (
    <div className="ml-4 space-y-1.5">
      {page.title && (
        <div className="inline-flex items-center gap-1.5">
          <McpProviderIcon provider="notion" className="size-3.5" />
          {hasLink ? (
            <a
              href={page.url!}
              target="_blank"
              rel="noopener noreferrer"
              className="group/page inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
            >
              {page.title}
              <ExternalLink className="size-2.5 opacity-0 group-hover/page:opacity-70 transition-opacity" />
            </a>
          ) : (
            <span className="text-[11px] font-medium text-foreground/90">
              {page.title}
            </span>
          )}
        </div>
      )}
      {preview && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/50 bg-muted/20 px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground/70">
          {preview}
        </pre>
      )}
    </div>
  );
}
