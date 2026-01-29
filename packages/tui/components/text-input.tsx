import { type PasteEvent, TextAttributes } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { inputFromKey, isMouseSequence } from "../lib/keyboard";

type TextInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  onCursorChange?: (position: number) => void;
  cursorPosition?: number;
  onUpArrow?: () => boolean | void;
  onDownArrow?: () => boolean | void;
  onTab?: () => boolean | void;
  onCtrlN?: () => boolean | void;
  onCtrlP?: () => boolean | void;
  onReturn?: () => boolean | void;
  onPaste?: (value: string) => boolean | void;
  isTokenChar?: (char: string) => boolean;
  renderToken?: (token: string) => string;
  placeholder?: string;
  focus?: boolean;
  showCursor?: boolean;
};

type TextSegment = {
  text: string;
  attributes?: number;
  fg?: string;
  bg?: string;
};

/**
 * Find the position of the previous word boundary (for Option+Left, Option+Delete)
 */
function findPrevWordBoundary(value: string, cursorOffset: number): number {
  if (cursorOffset <= 0) return 0;

  let pos = cursorOffset - 1;

  // Skip any trailing whitespace
  while (pos > 0 && /\s/.test(value[pos]!)) {
    pos--;
  }

  // Skip the word characters
  while (pos > 0 && !/\s/.test(value[pos - 1]!)) {
    pos--;
  }

  return pos;
}

/**
 * Find the position of the next word boundary (for Option+Right)
 */
function findNextWordBoundary(value: string, cursorOffset: number): number {
  if (cursorOffset >= value.length) return value.length;

  let pos = cursorOffset;

  // Skip current word characters
  while (pos < value.length && !/\s/.test(value[pos]!)) {
    pos++;
  }

  // Skip whitespace
  while (pos < value.length && /\s/.test(value[pos]!)) {
    pos++;
  }

  return pos;
}

/**
 * Find the position of the beginning of the current line (for Ctrl+A / Command+Left)
 */
function findLineStart(value: string, cursorOffset: number): number {
  if (cursorOffset <= 0) return 0;

  // Search backwards for a newline
  for (let i = cursorOffset - 1; i >= 0; i--) {
    if (value[i] === "\n") {
      return i + 1; // Position after the newline
    }
  }
  return 0; // No newline found, go to start
}

/**
 * Find the position of the end of the current line (for Ctrl+E / Command+Right)
 */
function findLineEnd(value: string, cursorOffset: number): number {
  // Search forwards for a newline
  for (let i = cursorOffset; i < value.length; i++) {
    if (value[i] === "\n") {
      return i; // Position before the newline
    }
  }
  return value.length; // No newline found, go to end
}

/**
 * Calculate the cursor position when moving up one line.
 * Returns -1 if already on the first line.
 */
function findPositionAbove(value: string, cursorOffset: number): number {
  const lineStart = findLineStart(value, cursorOffset);

  // If we're on the first line, return -1 to signal parent should handle
  if (lineStart === 0) {
    return -1;
  }

  // Column position within current line
  const column = cursorOffset - lineStart;

  // Find the start of the previous line (lineStart - 1 is the newline, go before it)
  const prevLineEnd = lineStart - 1;
  const prevLineStart = findLineStart(value, prevLineEnd);
  const prevLineLength = prevLineEnd - prevLineStart;

  // Move to same column on previous line, clamped to line length
  return prevLineStart + Math.min(column, prevLineLength);
}

/**
 * Calculate the cursor position when moving down one line.
 * Returns -1 if already on the last line.
 */
function findPositionBelow(value: string, cursorOffset: number): number {
  const lineEnd = findLineEnd(value, cursorOffset);

  // If we're on the last line, return -1 to signal parent should handle
  if (lineEnd === value.length) {
    return -1;
  }

  // Column position within current line
  const lineStart = findLineStart(value, cursorOffset);
  const column = cursorOffset - lineStart;

  // Next line starts after the newline
  const nextLineStart = lineEnd + 1;
  const nextLineEnd = findLineEnd(value, nextLineStart);
  const nextLineLength = nextLineEnd - nextLineStart;

  // Move to same column on next line, clamped to line length
  return nextLineStart + Math.min(column, nextLineLength);
}

export function TextInput({
  value: externalValue,
  onChange,
  onSubmit,
  onCursorChange,
  cursorPosition: externalCursorPosition,
  onUpArrow,
  onDownArrow,
  onTab,
  onCtrlN,
  onCtrlP,
  onReturn,
  onPaste,
  isTokenChar,
  renderToken,
  placeholder = "",
  focus = true,
  showCursor = true,
}: TextInputProps) {
  // Internal state - this is the source of truth during typing
  const [internalValue, setInternalValue] = useState(externalValue || "");
  const [cursorOffset, setCursorOffset] = useState(
    (externalValue || "").length,
  );

  // Refs to always have access to latest values in useKeyboard callback
  const valueRef = useRef(internalValue);
  const cursorRef = useRef(cursorOffset);
  const pasteBufferRef = useRef("");
  const pasteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep refs in sync with state
  valueRef.current = internalValue;
  cursorRef.current = cursorOffset;

  // Track last external values to detect intentional parent changes
  const lastExternalValueRef = useRef(externalValue);
  const lastExternalCursorRef = useRef(externalCursorPosition);

  // Sync with external value/cursor changes in one pass to avoid stale clamping.
  useLayoutEffect(() => {
    const valueChanged = externalValue !== lastExternalValueRef.current;
    const cursorProvided = externalCursorPosition !== undefined;
    const cursorChanged =
      cursorProvided &&
      externalCursorPosition !== lastExternalCursorRef.current;

    if (!valueChanged && !cursorChanged) return;

    const nextValue = valueChanged ? externalValue || "" : valueRef.current;
    let nextCursor = cursorRef.current;

    if (
      externalCursorPosition !== undefined &&
      (cursorChanged || valueChanged)
    ) {
      nextCursor = externalCursorPosition;
    } else if (valueChanged) {
      nextCursor = Math.min(nextCursor, nextValue.length);
    }

    if (nextCursor < 0) {
      nextCursor = 0;
    } else if (nextCursor > nextValue.length) {
      nextCursor = nextValue.length;
    }

    if (valueChanged) {
      setInternalValue(nextValue);
      valueRef.current = nextValue;
    }
    setCursorOffset(nextCursor);
    cursorRef.current = nextCursor;

    lastExternalValueRef.current = externalValue;
    lastExternalCursorRef.current = externalCursorPosition;
  }, [externalValue, externalCursorPosition]);

  // Helper to update value and notify parent
  const updateValue = useCallback(
    (newValue: string, newCursor: number) => {
      setInternalValue(newValue);
      setCursorOffset(newCursor);
      valueRef.current = newValue;
      cursorRef.current = newCursor;
      lastExternalValueRef.current = newValue;
      lastExternalCursorRef.current = newCursor;
      onChange(newValue);
      onCursorChange?.(newCursor);
    },
    [onChange, onCursorChange],
  );

  // Helper to update cursor only
  const updateCursor = useCallback(
    (newCursor: number) => {
      setCursorOffset(newCursor);
      cursorRef.current = newCursor;
      lastExternalCursorRef.current = newCursor;
      onCursorChange?.(newCursor);
    },
    [onCursorChange],
  );

  const flushPasteBuffer = useCallback(() => {
    let buffered = pasteBufferRef.current;
    if (!buffered) return;

    pasteBufferRef.current = "";
    if (pasteTimerRef.current) {
      clearTimeout(pasteTimerRef.current);
      pasteTimerRef.current = null;
    }

    // Strip bracketed paste escape sequences (used by Ghostty, iTerm2, etc.)
    // Start: \x1b[200~ End: \x1b[201~
    // oxlint-disable-next-line no-control-regex
    buffered = buffered.replace(/\x1b\[200~/g, "").replace(/\x1b\[201~/g, "");

    if (!buffered) return;

    if (onPaste) {
      const handled = onPaste(buffered);
      if (handled) return;
    }

    const currentValue = valueRef.current;
    const currentCursor = cursorRef.current;
    const nextValue =
      currentValue.slice(0, currentCursor) +
      buffered +
      currentValue.slice(currentCursor);
    const nextCursor = currentCursor + buffered.length;
    updateValue(nextValue, nextCursor);
  }, [onPaste, updateValue]);

  useEffect(() => {
    return () => {
      if (pasteTimerRef.current) {
        clearTimeout(pasteTimerRef.current);
      }
    };
  }, []);

  const value = internalValue;
  const tokenMatcher = useCallback(
    (char: string) => (isTokenChar ? isTokenChar(char) : false),
    [isTokenChar],
  );
  const tokenRenderer = useCallback(
    (token: string) => (renderToken ? renderToken(token) : token),
    [renderToken],
  );

  const segments = useMemo((): TextSegment[] => {
    const result: TextSegment[] = [];
    const placeholderText = placeholder ?? "";
    const cursorActive = Boolean(showCursor && focus);
    const cursorAttributes = TextAttributes.INVERSE;
    const cursorFg = "black";
    const cursorBg = "white";

    const pushSegment = (
      text: string,
      attributes?: number,
      fg?: string,
      bg?: string,
    ) => {
      if (!text) return;
      const last = result[result.length - 1];
      if (
        last &&
        last.attributes === attributes &&
        last.fg === fg &&
        last.bg === bg
      ) {
        last.text += text;
      } else {
        result.push({ text, attributes, fg, bg });
      }
    };

    if (value.length === 0) {
      if (placeholderText.length > 0) {
        if (cursorActive) {
          pushSegment(
            placeholderText[0] ?? " ",
            cursorAttributes,
            cursorFg,
            cursorBg,
          );
          pushSegment(placeholderText.slice(1), undefined, "gray");
        } else {
          pushSegment(placeholderText, undefined, "gray");
        }
      } else if (cursorActive) {
        pushSegment(" ", cursorAttributes, cursorFg, cursorBg);
      }
      return result;
    }

    for (let i = 0; i < value.length; i += 1) {
      const char = value[i];
      if (char === undefined) continue;

      const isCursor = cursorActive && i === cursorOffset;
      const display = tokenMatcher(char) ? tokenRenderer(char) : char;

      if (char === "\n") {
        if (isCursor) {
          pushSegment(" ", cursorAttributes, cursorFg, cursorBg);
        }
        pushSegment("\n");
        continue;
      }

      if (display.length === 0) {
        if (isCursor) {
          pushSegment(" ", cursorAttributes, cursorFg, cursorBg);
        }
        continue;
      }

      if (isCursor) {
        pushSegment(display, cursorAttributes, cursorFg, cursorBg);
      } else {
        pushSegment(display);
      }
    }

    if (cursorActive && cursorOffset === value.length) {
      pushSegment(" ", cursorAttributes, cursorFg, cursorBg);
    }

    return result;
  }, [
    value,
    cursorOffset,
    focus,
    showCursor,
    placeholder,
    tokenMatcher,
    tokenRenderer,
  ]);

  const handleInput = useCallback(
    (
      input: string,
      event: {
        name: string;
        ctrl: boolean;
        meta: boolean;
        shift: boolean;
        sequence?: string;
      } | null,
    ) => {
      // Always read from refs to get latest values
      const currentValue = valueRef.current;
      const currentCursor = cursorRef.current;

      const name = event?.name ?? "";
      const ctrl = event?.ctrl ?? false;
      const meta = event?.meta ?? false;
      const shift = event?.shift ?? false;
      const sequence = event?.sequence;
      if (sequence && isMouseSequence(sequence)) {
        return;
      }
      const isReturn = name === "return" || name === "linefeed";
      const isBackspace = name === "backspace";
      const isDelete = name === "delete";
      const isUpArrow = name === "up";
      const isDownArrow = name === "down";
      const isLeftArrow = name === "left";
      const isRightArrow = name === "right";
      const isEscape = name === "escape";
      const isTab = name === "tab";

      // Handle paste buffering
      if (onPaste && input.length > 1) {
        pasteBufferRef.current += input;
        if (pasteTimerRef.current) {
          clearTimeout(pasteTimerRef.current);
        }
        pasteTimerRef.current = setTimeout(() => {
          flushPasteBuffer();
        }, 50);
        return;
      }

      // If we have a paste buffer and receive a single printable character,
      // it's likely the tail end of a paste that got split. Add it to the buffer
      // and flush immediately.
      if (
        pasteBufferRef.current &&
        input.length === 1 &&
        !isBackspace &&
        !isDelete &&
        !isReturn &&
        !isEscape &&
        !isTab
      ) {
        pasteBufferRef.current += input;
        flushPasteBuffer();
        return;
      }

      // Flush any pending paste buffer for non-character keys
      if (pasteBufferRef.current) {
        flushPasteBuffer();
      }

      // Handle up arrow - navigate within multiline text, or let parent handle
      if (isUpArrow) {
        if (showCursor) {
          const newPos = findPositionAbove(currentValue, currentCursor);
          if (newPos !== -1) {
            updateCursor(newPos);
            return;
          }
        }
        // On first line or cursor hidden - let parent intercept
        if (onUpArrow?.()) return;
        return; // Still block if no handler
      }

      // Handle down arrow - navigate within multiline text, or let parent handle
      if (isDownArrow) {
        if (showCursor) {
          const newPos = findPositionBelow(currentValue, currentCursor);
          if (newPos !== -1) {
            updateCursor(newPos);
            return;
          }
        }
        // On last line or cursor hidden - let parent intercept
        if (onDownArrow?.()) return;
        return; // Still block if no handler
      }

      // Handle tab - let parent intercept if needed
      if (isTab && !shift) {
        if (onTab?.()) return;
        return; // Still block if no handler
      }

      // Handle Ctrl+N - let parent intercept if needed
      if (ctrl && input === "n") {
        if (onCtrlN?.()) return;
      }

      // Handle Ctrl+P - let parent intercept if needed
      if (ctrl && input === "p") {
        onCtrlP?.();
        return; // Always consume ctrl+p to prevent inserting 'p'
      }

      // Ignore certain key combinations
      const ignoredCtrlKeys = ["c", "o", "t"];
      if ((ctrl && ignoredCtrlKeys.includes(input)) || (shift && isTab)) {
        return;
      }

      if (isReturn) {
        const isShiftReturnSequence =
          sequence === "\n" ||
          sequence === "\x1b[13;2u" ||
          sequence === "\x1b[10;2u" ||
          sequence === "\x1b[27;2;13~" ||
          sequence === "\x1b[27;2;10~";
        if (shift || name === "linefeed" || isShiftReturnSequence) {
          const nextValue =
            currentValue.slice(0, currentCursor) +
            "\n" +
            currentValue.slice(currentCursor);
          updateValue(nextValue, currentCursor + 1);
          return;
        }
        // Let parent intercept return (e.g., for autocomplete)
        if (onReturn?.()) return;
        if (onSubmit) {
          onSubmit(currentValue);
        }
        return;
      }

      let nextCursorOffset = currentCursor;
      let nextValue = currentValue;
      if (isLeftArrow) {
        if (showCursor) {
          // Option+Left: Move to previous word boundary
          if (meta) {
            nextCursorOffset = findPrevWordBoundary(
              currentValue,
              currentCursor,
            );
          } else {
            nextCursorOffset--;
          }
        }
      } else if (isRightArrow) {
        if (showCursor) {
          // Option+Right: Move to next word boundary
          if (meta) {
            nextCursorOffset = findNextWordBoundary(
              currentValue,
              currentCursor,
            );
          } else {
            nextCursorOffset++;
          }
        }
      } else if (meta && input === "b") {
        // Option+Left (emacs-style): Move to previous word boundary
        if (showCursor) {
          nextCursorOffset = findPrevWordBoundary(currentValue, currentCursor);
        }
      } else if (meta && input === "f") {
        // Option+Right (emacs-style): Move to next word boundary
        if (showCursor) {
          nextCursorOffset = findNextWordBoundary(currentValue, currentCursor);
        }
      } else if (ctrl && input === "a") {
        // Ctrl+A (Command+Left): Move to beginning of current line
        if (showCursor) {
          nextCursorOffset = findLineStart(currentValue, currentCursor);
        }
      } else if (ctrl && input === "e") {
        // Ctrl+E (Command+Right): Move to end of current line
        if (showCursor) {
          nextCursorOffset = findLineEnd(currentValue, currentCursor);
        }
      } else if (ctrl && input === "u") {
        // Ctrl+U: Delete to beginning of current line (Cmd+Delete equivalent)
        const lineStart = findLineStart(currentValue, currentCursor);
        if (currentCursor > lineStart) {
          nextValue =
            currentValue.slice(0, lineStart) +
            currentValue.slice(currentCursor);
          nextCursorOffset = lineStart;
        }
      } else if (ctrl && input === "w") {
        // Ctrl+W: Delete previous word (unix-style, Option+Delete equivalent)
        if (currentCursor > 0) {
          const wordBoundary = findPrevWordBoundary(
            currentValue,
            currentCursor,
          );
          nextValue =
            currentValue.slice(0, wordBoundary) +
            currentValue.slice(currentCursor);
          nextCursorOffset = wordBoundary;
        }
      } else if (isBackspace || isDelete) {
        if (currentCursor > 0) {
          // Option+Delete (meta + delete/backspace): Delete previous word
          if (meta) {
            const wordBoundary = findPrevWordBoundary(
              currentValue,
              currentCursor,
            );
            nextValue =
              currentValue.slice(0, wordBoundary) +
              currentValue.slice(currentCursor);
            nextCursorOffset = wordBoundary;
          } else {
            // Regular backspace: delete one character
            nextValue =
              currentValue.slice(0, currentCursor - 1) +
              currentValue.slice(currentCursor);
            nextCursorOffset--;
          }
        }
      } else {
        // Regular character input
        nextValue =
          currentValue.slice(0, currentCursor) +
          input +
          currentValue.slice(currentCursor);
        nextCursorOffset += input.length;
      }

      // Clamp cursor position
      if (nextCursorOffset < 0) {
        nextCursorOffset = 0;
      }
      if (nextCursorOffset > nextValue.length) {
        nextCursorOffset = nextValue.length;
      }

      if (nextValue !== currentValue) {
        updateValue(nextValue, nextCursorOffset);
      } else if (nextCursorOffset !== currentCursor) {
        updateCursor(nextCursorOffset);
      }
    },
    [
      flushPasteBuffer,
      onCtrlN,
      onCtrlP,
      onDownArrow,
      onPaste,
      onReturn,
      onSubmit,
      onTab,
      onUpArrow,
      showCursor,
      updateCursor,
      updateValue,
    ],
  );

  const renderer = useRenderer();

  useKeyboard((event) => {
    if (!focus) return;
    const input = inputFromKey(event);
    handleInput(input, event);
  });

  useEffect(() => {
    const onPaste = (event: PasteEvent) => {
      if (!focus) return;
      handleInput(event.text, null);
    };

    renderer.keyInput.on("paste", onPaste);
    return () => {
      renderer.keyInput.off("paste", onPaste);
    };
  }, [focus, handleInput, renderer]);

  return (
    <text>
      {segments.map((segment, index) => (
        <span
          key={`text-input-segment-${index}`}
          fg={segment.fg}
          bg={segment.bg}
          attributes={segment.attributes}
        >
          {segment.text}
        </span>
      ))}
    </text>
  );
}
