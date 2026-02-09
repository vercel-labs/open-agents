import type { BaseCodeOptions, BaseDiffOptions } from "@pierre/diffs/react";

const unsafeCSS = `
  :host {
    display: block;
    max-width: 100%;
    --diffs-bg: var(--background);
    --diffs-fg: var(--foreground);
    --diffs-font-family: var(--font-geist-mono);
    --diffs-tab-size: 2;
    --diffs-gap-inline: 8px;
    --diffs-gap-block: 0px;
  }
`;

export const defaultDiffOptions = {
  theme: "github-dark",
  diffStyle: "unified",
  diffIndicators: "classic",
  overflow: "scroll",
  disableFileHeader: true,
  unsafeCSS,
} satisfies BaseDiffOptions;

export const defaultFileOptions = {
  theme: "github-dark",
  overflow: "scroll",
  disableFileHeader: true,
  unsafeCSS,
} satisfies BaseCodeOptions;
