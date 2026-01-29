import type { KeyEvent } from "@opentui/core";

export function inputFromKey(event: KeyEvent): string {
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
