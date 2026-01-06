import React, {
  createContext,
  useContext,
  useCallback,
  useRef,
  type ReactNode,
} from "react";

type ReasoningDuration = {
  startTime: number;
  endTime?: number;
};

export type ThinkingState = {
  isThinking: boolean;
  thinkingDuration: number | null; // null = not started, number = seconds
};

type ReasoningContextValue = {
  startReasoning: (messageId: string) => void;
  endReasoning: (messageId: string) => void;
  getThinkingState: (messageId: string) => ThinkingState;
};

const ReasoningContext = createContext<ReasoningContextValue | undefined>(
  undefined,
);

export function ReasoningProvider({ children }: { children: ReactNode }) {
  const durationsRef = useRef<Map<string, ReasoningDuration>>(new Map());

  const startReasoning = useCallback((messageId: string) => {
    if (!durationsRef.current.has(messageId)) {
      durationsRef.current.set(messageId, { startTime: Date.now() });
    }
  }, []);

  const endReasoning = useCallback((messageId: string) => {
    const duration = durationsRef.current.get(messageId);
    if (duration && !duration.endTime) {
      duration.endTime = Date.now();
    }
  }, []);

  const getThinkingState = useCallback((messageId: string): ThinkingState => {
    const duration = durationsRef.current.get(messageId);
    if (!duration) {
      return { isThinking: false, thinkingDuration: null };
    }
    if (!duration.endTime) {
      return { isThinking: true, thinkingDuration: null };
    }
    const seconds = Math.max(
      1,
      Math.round((duration.endTime - duration.startTime) / 1000),
    );
    return { isThinking: false, thinkingDuration: seconds };
  }, []);

  return (
    <ReasoningContext.Provider
      value={{
        startReasoning,
        endReasoning,
        getThinkingState,
      }}
    >
      {children}
    </ReasoningContext.Provider>
  );
}

export function useReasoningContext() {
  const context = useContext(ReasoningContext);
  if (!context) {
    throw new Error(
      "useReasoningContext must be used within a ReasoningProvider",
    );
  }
  return context;
}
