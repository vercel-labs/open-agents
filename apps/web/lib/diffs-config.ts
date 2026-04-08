import type {
  BaseCodeOptions,
  HunkData,
  ExpansionDirections,
} from "@pierre/diffs/react";
import type { FileDiffOptions } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs";
import "./vercel-themes";

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
    --diffs-addition-color-override: #3dc96a;
    --diffs-deletion-color-override: #f04b78;
    --diffs-bg-addition-override: rgba(61, 201, 106, 0.12);
    --diffs-bg-deletion-override: rgba(240, 75, 120, 0.12);
  }
`;

const theme = {
  dark: "vercel-dark",
  light: "vercel-light",
} as const;

/* ------------------------------------------------------------------ */
/* Custom hunk separator                                               */
/* Uses inline styles because the diff renders inside Shadow DOM       */
/* where Tailwind classes are not available.                            */
/* ------------------------------------------------------------------ */

function renderCustomSeparator(
  hunkData: HunkData,
  instance: FileDiff<undefined>,
) {
  const wrapper = document.createElement("div");
  Object.assign(wrapper.style, {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    paddingLeft: "22px",
    paddingTop: "4px",
    paddingBottom: "4px",
    fontSize: "0.75rem",
    fontFamily:
      "var(--diffs-header-font-family, var(--diffs-header-font-fallback))",
    color: "var(--diffs-fg-number)",
    background: "var(--diffs-bg-header, var(--diffs-bg))",
    borderTop: "1px solid color-mix(in srgb, var(--diffs-fg) 10%, transparent)",
    borderBottom:
      "1px solid color-mix(in srgb, var(--diffs-fg) 10%, transparent)",
  });

  if (hunkData.type === "additions") {
    // Collapsed additions — render a minimal spacer row
    wrapper.textContent = "\u00A0";
    return wrapper;
  }

  const lineLabel = hunkData.lines === 1 ? "line" : "lines";
  const labelText = `${hunkData.lines} unmodified ${lineLabel}`;

  function createControl(direction: ExpansionDirections) {
    const button = document.createElement("button");
    button.type = "button";
    Object.assign(button.style, {
      margin: "0",
      display: "inline-flex",
      cursor: "pointer",
      appearance: "none",
      alignItems: "center",
      border: "none",
      background: "transparent",
      padding: "0",
      color: "inherit",
    });

    const icon = document.createElement("span");
    Object.assign(icon.style, {
      fontFamily: "var(--diffs-font-family, var(--diffs-font-fallback))",
      fontSize: "1rem",
      lineHeight: "1",
    });
    icon.textContent =
      direction === "up" ? "↓" : direction === "down" ? "↑" : "↕";

    const label = document.createElement("span");
    Object.assign(label.style, {
      marginLeft: "8px",
      whiteSpace: "nowrap",
    });
    label.textContent = labelText;

    button.append(icon, label);
    button.onclick = () => instance.expandHunk(hunkData.hunkIndex, direction);
    return button;
  }

  const controls = document.createElement("div");
  Object.assign(controls.style, {
    display: "inline-flex",
    gap: "4px",
  });

  if (hunkData.expandable?.up && hunkData.expandable?.down) {
    controls.append(createControl("both"));
  } else if (hunkData.expandable?.up) {
    controls.append(createControl("up"));
  } else if (hunkData.expandable?.down) {
    controls.append(createControl("down"));
  }

  wrapper.append(controls);
  return wrapper;
}

/* ------------------------------------------------------------------ */
/* Exported option presets                                              */
/* ------------------------------------------------------------------ */

export const defaultDiffOptions: FileDiffOptions<undefined> = {
  theme,
  diffStyle: "unified",
  diffIndicators: "classic",
  overflow: "scroll",
  disableFileHeader: true,
  unsafeCSS,
  hunkSeparators: (
    hunkData: HunkData,
    instance: FileDiff<undefined>,
  ) => renderCustomSeparator(hunkData, instance),
};

export const splitDiffOptions: FileDiffOptions<undefined> = {
  ...defaultDiffOptions,
  diffStyle: "split",
};

export const defaultFileOptions = {
  theme,
  overflow: "scroll",
  disableFileHeader: true,
  unsafeCSS,
} satisfies BaseCodeOptions;
