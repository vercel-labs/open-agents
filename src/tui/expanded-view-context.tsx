import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";

type ExpandedViewContextValue = {
  isExpanded: boolean;
  toggleExpanded: () => void;
};

const ExpandedViewContext = createContext<ExpandedViewContextValue | undefined>(
  undefined,
);

export function ExpandedViewProvider({ children }: { children: ReactNode }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  return (
    <ExpandedViewContext.Provider
      value={{
        isExpanded,
        toggleExpanded,
      }}
    >
      {children}
    </ExpandedViewContext.Provider>
  );
}

export function useExpandedView() {
  const context = useContext(ExpandedViewContext);
  if (!context) {
    throw new Error(
      "useExpandedView must be used within an ExpandedViewProvider",
    );
  }
  return context;
}
