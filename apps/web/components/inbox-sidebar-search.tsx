"use client";

import { X } from "lucide-react";
import type { ChangeEvent, KeyboardEvent } from "react";
import type { SessionWithUnread } from "@/hooks/use-sessions";

type InboxSidebarSearchProps = {
  value: string;
  onChange: (value: string) => void;
};

export function InboxSidebarSearch({
  value,
  onChange,
}: InboxSidebarSearchProps) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onChange(event.target.value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onChange("");
      event.currentTarget.blur();
    }
  }

  return (
    <div className="relative px-2 pt-2">
      <input
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Filter sessions"
        aria-label="Filter sessions"
        className="w-full rounded-md border border-border/60 bg-background px-3 py-1.5 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus:border-border focus:outline-none"
      />
      {value.length > 0 ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear filter"
          className="-translate-y-1/2 absolute top-1/2 right-3.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

export function matchesSessionQuery(
  session: SessionWithUnread,
  query: string,
): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return true;
  }

  const haystacks: string[] = [];
  if (session.title) {
    haystacks.push(session.title);
  }
  if (session.repoOwner) {
    haystacks.push(session.repoOwner);
  }
  if (session.repoName) {
    haystacks.push(session.repoName);
  }
  if (session.branch) {
    haystacks.push(session.branch);
  }

  return haystacks.some((value) => value.toLowerCase().includes(trimmed));
}
