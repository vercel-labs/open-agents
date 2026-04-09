"use client";

import { ArrowRight, MessageSquarePlus, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SelectionPopoverProps = {
  /** Ref to the container element to monitor for text selection */
  containerRef: RefObject<HTMLElement | null>;
  /** Callback when user submits an annotation */
  onAddToPrompt: (selectedText: string, comment: string) => void;
};

type PopoverState =
  | { type: "hidden" }
  | { type: "button"; selectedText: string; rect: DOMRect }
  | { type: "input"; selectedText: string; rect: DOMRect };

/**
 * Floating popover that appears when the user selects text within a container.
 * Shows a "Comment" button, then expands to an inline textarea + "Add to Prompt".
 */
export function SelectionPopover({
  containerRef,
  onAddToPrompt,
}: SelectionPopoverProps) {
  const [state, setState] = useState<PopoverState>({ type: "hidden" });
  const [comment, setComment] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Track whether an interaction originated inside the popover so that
  // container-level mouse handlers can bail out.
  const interactingRef = useRef(false);

  const hide = useCallback(() => {
    setState({ type: "hidden" });
    setComment("");
  }, []);

  // Get selected text from within the container, including shadow DOM
  const getSelectionText = useCallback((): {
    text: string;
    rect: DOMRect | null;
  } | null => {
    const container = containerRef.current;
    if (!container) return null;

    // Check normal selection first
    const selection = window.getSelection();
    if (selection && selection.toString().trim().length > 0) {
      const range = selection.getRangeAt(0);
      const rangeRect = range.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      const overlaps =
        rangeRect.top < containerRect.bottom &&
        rangeRect.bottom > containerRect.top &&
        rangeRect.left < containerRect.right &&
        rangeRect.right > containerRect.left;

      if (overlaps) {
        return { text: selection.toString().trim(), rect: rangeRect };
      }
    }

    // Also check shadow roots inside the container for selections
    const shadowHosts = container.querySelectorAll("*");
    for (const host of shadowHosts) {
      if (host.shadowRoot) {
        const shadowSelection = (
          host.shadowRoot as unknown as {
            getSelection?: () => Selection | null;
          }
        ).getSelection?.();
        if (shadowSelection && shadowSelection.toString().trim().length > 0) {
          const range = shadowSelection.getRangeAt(0);
          return {
            text: shadowSelection.toString().trim(),
            rect: range.getBoundingClientRect(),
          };
        }
      }
    }

    return null;
  }, [containerRef]);

  // Listen for mouse events on the container to detect text selection.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseUp = () => {
      // If the mouseup came from within the popover, skip entirely.
      if (interactingRef.current) return;

      // Small delay to let the browser finalize selection
      requestAnimationFrame(() => {
        // Never dismiss the expanded input form from a selection change
        if (state.type === "input") return;

        const result = getSelectionText();
        if (result && result.text.length > 0 && result.rect) {
          setState({
            type: "button",
            selectedText: result.text,
            rect: result.rect,
          });
        } else {
          hide();
        }
      });
    };

    const handleMouseDown = (e: MouseEvent) => {
      // Clicks inside the popover are handled by the popover itself.
      if (popoverRef.current && popoverRef.current.contains(e.target as Node)) {
        return;
      }

      // In input mode, keep the form open regardless of where the user clicks
      // inside the container (they might be re-selecting text, scrolling, etc.)
      if (state.type === "input") return;

      // In button mode a click elsewhere means the user is starting a new
      // selection or clearing the current one – hide.
      hide();
    };

    container.addEventListener("mouseup", handleMouseUp);
    container.addEventListener("mousedown", handleMouseDown);

    return () => {
      container.removeEventListener("mouseup", handleMouseUp);
      container.removeEventListener("mousedown", handleMouseDown);
    };
  }, [containerRef, getSelectionText, hide, state.type]);

  // Focus textarea when expanding to input mode
  useEffect(() => {
    if (state.type === "input") {
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    }
  }, [state.type]);

  // Dismiss on click outside the container entirely (e.g. the dialog backdrop).
  useEffect(() => {
    if (state.type === "hidden") return;

    const handleClickOutside = (e: MouseEvent) => {
      const container = containerRef.current;
      if (container && container.contains(e.target as Node)) return;
      if (popoverRef.current && popoverRef.current.contains(e.target as Node)) {
        return;
      }
      hide();
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [state.type, containerRef, hide]);

  const handleCommentClick = useCallback(() => {
    if (state.type !== "button") return;
    setState({
      type: "input",
      selectedText: state.selectedText,
      rect: state.rect,
    });
  }, [state]);

  const handleSubmit = useCallback(() => {
    if (state.type !== "input") return;
    onAddToPrompt(state.selectedText, comment.trim());
    hide();
    window.getSelection()?.removeAllRanges();
  }, [state, comment, onAddToPrompt, hide]);

  if (state.type === "hidden") {
    return null;
  }

  const container = containerRef.current;
  if (!container) return null;

  const containerRect = container.getBoundingClientRect();
  const selectionRect = state.rect;

  // Position below the selection, clamped within the container
  const top =
    selectionRect.bottom - containerRect.top + container.scrollTop + 8;
  const left = Math.max(
    8,
    Math.min(
      selectionRect.left +
        selectionRect.width / 2 -
        containerRect.left -
        (state.type === "input" ? 160 : 50),
      containerRect.width - (state.type === "input" ? 328 : 108),
    ),
  );

  return (
    <div
      ref={popoverRef}
      role="dialog"
      className={cn(
        "absolute z-50 animate-in fade-in-0 zoom-in-95 duration-150",
        "rounded-xl border border-border bg-popover shadow-lg",
      )}
      style={{
        top: `${top}px`,
        left: `${left}px`,
      }}
      // Stop BOTH mousedown and mouseup from reaching the container so that
      // the selection-detection logic never fires while the user interacts
      // with the popover itself.
      onMouseDown={(e) => {
        e.stopPropagation();
        interactingRef.current = true;
      }}
      onMouseUp={(e) => {
        e.stopPropagation();
        // Reset on next tick so the flag is cleared after all handlers run
        requestAnimationFrame(() => {
          interactingRef.current = false;
        });
      }}
    >
      {state.type === "button" ? (
        <button
          type="button"
          onClick={handleCommentClick}
          className={cn(
            "flex items-center gap-2 rounded-xl px-3 py-2",
            "text-sm font-medium text-popover-foreground",
            "transition-colors hover:bg-muted",
          )}
        >
          <MessageSquarePlus className="h-4 w-4" />
          <span>Comment</span>
        </button>
      ) : (
        <div className="flex w-80 flex-col gap-2 p-3">
          {/* Selected text preview */}
          <div className="max-h-20 overflow-auto rounded-md bg-muted/60 px-2.5 py-1.5">
            <p className="line-clamp-3 font-mono text-xs text-muted-foreground">
              {state.selectedText}
            </p>
          </div>

          {/* Comment textarea */}
          <textarea
            ref={textareaRef}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a note or instruction..."
            rows={2}
            className={cn(
              "w-full resize-none rounded-md border border-border bg-background px-2.5 py-2",
              "text-sm text-foreground placeholder:text-muted-foreground",
              "focus:outline-none focus:ring-1 focus:ring-ring",
            )}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSubmit();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                hide();
              }
            }}
          />

          {/* Actions */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={hide}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-3 w-3" />
              Cancel
            </button>
            <Button
              type="button"
              size="sm"
              onClick={handleSubmit}
              className="h-7 gap-1.5 rounded-lg px-3 text-xs font-medium"
            >
              Add to Prompt
              <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
