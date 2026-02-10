import type { KeyEvent } from "@opentui/core";

export function isMouseSequence(sequence: string): boolean {
  if (sequence.startsWith("\x1b[<") || sequence.startsWith("\x1b[M")) {
    return true;
  }
  const trimmed = sequence.trim();
  return trimmed.startsWith("<") && /^<\d+;\d+;\d+[mM]$/.test(trimmed);
}

export function inputFromKey(event: KeyEvent): string {
  if (isMouseSequence(event.sequence)) return "";
  if (event.sequence.length === 1 && event.sequence >= " ") {
    return event.sequence;
  }
  if (event.name === "space") return " ";
  if (event.name.length === 1) return event.name;
  return "";
}

export function isReturnKey(event: KeyEvent): boolean {
  return event.name === "return" || event.name === "linefeed";
}
