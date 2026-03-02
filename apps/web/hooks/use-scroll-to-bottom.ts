import { useCallback, useEffect, useRef, useState } from "react";

export function useScrollToBottom<T extends HTMLElement>() {
  const containerRef = useRef<T>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);

  const scrollToBottom = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, []);

  const handleScroll = useCallback(() => {
    if (containerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
      const threshold = 10;
      const atBottom = scrollHeight - scrollTop - clientHeight < threshold;

      if (isAtBottomRef.current !== atBottom) {
        isAtBottomRef.current = atBottom;
        setIsAtBottom(atBottom);
      }
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.addEventListener("scroll", handleScroll, { passive: true });
      // Scroll to bottom on initial mount
      container.scrollTop = container.scrollHeight;
      handleScroll();

      // Auto-scroll when content grows (e.g. chunked stream replay).
      // Uses a ref for the at-bottom check so the callback always reads
      // the latest scroll position without needing to re-create the observer.
      const resizeObserver = new ResizeObserver(() => {
        if (isAtBottomRef.current) {
          container.scrollTop = container.scrollHeight;
        }
      });

      // Observe the container itself (viewport resize) and its first child
      // (content height changes from new chunks / messages being appended).
      resizeObserver.observe(container);
      if (container.firstElementChild) {
        resizeObserver.observe(container.firstElementChild);
      }

      return () => {
        container.removeEventListener("scroll", handleScroll);
        resizeObserver.disconnect();
      };
    }
  }, [handleScroll]);

  return {
    containerRef,
    isAtBottom,
    scrollToBottom,
  };
}
