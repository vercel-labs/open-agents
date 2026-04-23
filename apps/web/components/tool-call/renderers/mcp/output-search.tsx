"use client";

import { ExternalLink } from "lucide-react";
import type { SearchResult } from "./shared";
import { isValidExternalUrl, formatTimestamp } from "./shared";
import { SourceTypeIcon } from "./source-icons";

export function SearchResultItem({ result }: { result: SearchResult }) {
  const hasLink = isValidExternalUrl(result.url);
  const Tag = hasLink ? "a" : "div";
  const linkProps = hasLink
    ? {
        href: result.url!,
        target: "_blank" as const,
        rel: "noopener noreferrer",
      }
    : {};

  return (
    <Tag
      {...linkProps}
      className="group/result flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-muted/50 transition-colors"
    >
      <SourceTypeIcon
        type={result.type ?? "unknown"}
        className="size-3 shrink-0"
      />
      <span className="text-[11px] font-medium text-foreground/90 truncate">
        {result.title}
      </span>
      {result.timestamp && (
        <span className="text-[10px] text-muted-foreground/40 shrink-0">
          {formatTimestamp(result.timestamp)}
        </span>
      )}
      {hasLink && (
        <ExternalLink className="size-3 shrink-0 ml-auto text-muted-foreground/0 group-hover/result:text-muted-foreground/50 transition-colors" />
      )}
    </Tag>
  );
}
