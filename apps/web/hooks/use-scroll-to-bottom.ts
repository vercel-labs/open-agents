import { useCallback, useEffect, useRef, useState } from "react";

export function useScrollToBottom<T extends HTMLElement>() {
  const containerRef = useRef<T>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);
  const resizeRafRef = useRef<number | null>(null);
  const lastScrollHeightRef = useRef(0);

  const scrollToBottom = useCallback(() => {
    if (containerRef.current) {
      const nextHeight = containerRef.current.scrollHeight;
      containerRef.current.scrollTop = nextHeight;
      lastScrollHeightRef.current = nextHeight;
    }
  }, []);

  const handleScroll = useCallback(() => {
    if (containerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
      const threshold = 10;
      const atBottom = scrollHeight - scrollTop - clientHeight < threshold;
      isAtBottomRef.current = atBottom;
      setIsAtBottom(atBottom);
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.addEventListener("scroll", handleScroll, { passive: true });
      // Scroll to bottom on initial mount
      container.scrollTop = container.scrollHeight;
      lastScrollHeightRef.current = container.scrollHeight;
      handleScroll();

      // Auto-scroll when content grows (e.g. chunked stream replay).
      // Coalesce resize events into a single frame to avoid rapid scroll writes
      // when many tool cards reflow during streaming.
      const scheduleAutoScroll = () => {
        if (!isAtBottomRef.current || resizeRafRef.current !== null) {
          return;
        }

        resizeRafRef.current = requestAnimationFrame(() => {
          resizeRafRef.current = null;
          const current = containerRef.current;
          if (!current || !isAtBottomRef.current) {
            return;
          }

          const nextHeight = current.scrollHeight;
          const previousHeight = lastScrollHeightRef.current;
          lastScrollHeightRef.current = nextHeight;

          // Ignore non-growth resizes (e.g. width/layout churn) to reduce jank.
          if (nextHeight <= previousHeight) {
            return;
          }

          current.scrollTop = nextHeight;
        });
      };

      const resizeObserver = new ResizeObserver(scheduleAutoScroll);

      // Observe the container itself (viewport resize) and its first child
      // (content height changes from new chunks / messages being appended).
      resizeObserver.observe(container);
      if (container.firstElementChild) {
        resizeObserver.observe(container.firstElementChild);
      }

      return () => {
        container.removeEventListener("scroll", handleScroll);
        resizeObserver.disconnect();
        if (resizeRafRef.current !== null) {
          cancelAnimationFrame(resizeRafRef.current);
          resizeRafRef.current = null;
        }
      };
    }
  }, [handleScroll]);

  return {
    containerRef,
    isAtBottom,
    scrollToBottom,
  };
}
