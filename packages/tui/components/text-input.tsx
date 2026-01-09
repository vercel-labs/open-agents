import React, {
  useState,
  useRef,
  useCallback,
  useLayoutEffect,
  useEffect,
} from "react";
import { Text, useInput } from "ink";
import chalk from "chalk";

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

/**
 * Find the position of the previous word boundary (for Option+Delete)
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

  // Refs to always have access to latest values in useInput callback
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
  let renderedValue = value;
  let renderedPlaceholder = placeholder ? chalk.grey(placeholder) : undefined;
  const tokenMatcher = isTokenChar ?? (() => false);
  const tokenRenderer = renderToken ?? ((token: string) => token);

  const buildRenderedValue = (withCursor: boolean): string => {
    if (!withCursor) {
      let result = "";
      for (const char of value) {
        result += tokenMatcher(char) ? tokenRenderer(char) : char;
      }
      return result;
    }

    if (value.length === 0) {
      return chalk.inverse(" ");
    }

    let result = "";
    let i = 0;
    for (const char of value) {
      const isCursor = i === cursorOffset;
      if (tokenMatcher(char)) {
        const tokenText = tokenRenderer(char);
        if (isCursor) {
          result +=
            tokenText.length > 0
              ? chalk.inverse(tokenText[0]) + tokenText.slice(1)
              : chalk.inverse(" ");
        } else {
          result += tokenText;
        }
      } else {
        result += isCursor ? chalk.inverse(char) : char;
      }
      i++;
    }

    if (cursorOffset === value.length) {
      result += chalk.inverse(" ");
    }
    return result;
  };

  // Fake mouse cursor
  if (showCursor && focus) {
    renderedPlaceholder =
      placeholder.length > 0
        ? chalk.inverse(placeholder[0]) + chalk.grey(placeholder.slice(1))
        : chalk.inverse(" ");
    renderedValue = buildRenderedValue(true);
  } else {
    renderedValue = buildRenderedValue(false);
  }

  useInput(
    (input, key) => {
      // Always read from refs to get latest values
      const currentValue = valueRef.current;
      const currentCursor = cursorRef.current;

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
        !key.backspace &&
        !key.delete &&
        !key.return &&
        !key.escape &&
        !key.tab
      ) {
        pasteBufferRef.current += input;
        flushPasteBuffer();
        return;
      }

      // Flush any pending paste buffer for non-character keys
      if (pasteBufferRef.current) {
        flushPasteBuffer();
      }

      // Handle up arrow - let parent intercept if needed
      if (key.upArrow) {
        if (onUpArrow?.()) return;
        return; // Still block if no handler
      }

      // Handle down arrow - let parent intercept if needed
      if (key.downArrow) {
        if (onDownArrow?.()) return;
        return; // Still block if no handler
      }

      // Handle tab - let parent intercept if needed
      if (key.tab && !key.shift) {
        if (onTab?.()) return;
        return; // Still block if no handler
      }

      // Handle Ctrl+N - let parent intercept if needed
      if (key.ctrl && input === "n") {
        if (onCtrlN?.()) return;
      }

      // Handle Ctrl+P - let parent intercept if needed
      if (key.ctrl && input === "p") {
        onCtrlP?.();
        return; // Always consume ctrl+p to prevent inserting 'p'
      }

      // Ignore certain key combinations
      const ignoredCtrlKeys = ["c", "o", "t"];
      if (
        (key.ctrl && ignoredCtrlKeys.includes(input)) ||
        (key.shift && key.tab)
      ) {
        return;
      }

      if (key.return) {
        // Let parent intercept return (e.g., for autocomplete)
        if (onReturn?.()) return;
        if (onSubmit) {
          onSubmit(currentValue);
        }
        return;
      }

      let nextCursorOffset = currentCursor;
      let nextValue = currentValue;
      if (key.leftArrow) {
        if (showCursor) {
          // Option+Left: Move to previous word boundary
          if (key.meta) {
            nextCursorOffset = findPrevWordBoundary(
              currentValue,
              currentCursor,
            );
          } else {
            nextCursorOffset--;
          }
        }
      } else if (key.rightArrow) {
        if (showCursor) {
          // Option+Right: Move to next word boundary
          if (key.meta) {
            let pos = currentCursor;
            // Skip current word
            while (
              pos < currentValue.length &&
              !/\s/.test(currentValue[pos]!)
            ) {
              pos++;
            }
            // Skip whitespace
            while (pos < currentValue.length && /\s/.test(currentValue[pos]!)) {
              pos++;
            }
            nextCursorOffset = pos;
          } else {
            nextCursorOffset++;
          }
        }
      } else if (key.ctrl && input === "u") {
        // Ctrl+U: Delete entire line to the left (Cmd+Delete equivalent)
        if (currentCursor > 0) {
          nextValue = currentValue.slice(currentCursor);
          nextCursorOffset = 0;
        }
      } else if (key.ctrl && input === "w") {
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
      } else if (key.backspace || key.delete) {
        if (currentCursor > 0) {
          // Option+Delete (meta + delete): Delete previous word
          if (key.delete && key.meta) {
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
    { isActive: focus },
  );

  return (
    <Text>
      {placeholder
        ? value.length > 0
          ? renderedValue
          : renderedPlaceholder
        : renderedValue}
    </Text>
  );
}
