import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";

type TodoViewContextValue = {
  isTodoVisible: boolean;
  toggleTodoView: () => void;
};

const TodoViewContext = createContext<TodoViewContextValue | undefined>(
  undefined,
);

export function TodoViewProvider({ children }: { children: ReactNode }) {
  const [isTodoVisible, setIsTodoVisible] = useState(true);

  const toggleTodoView = useCallback(() => {
    setIsTodoVisible((prev) => !prev);
  }, []);

  return (
    <TodoViewContext.Provider
      value={{
        isTodoVisible,
        toggleTodoView,
      }}
    >
      {children}
    </TodoViewContext.Provider>
  );
}

export function useTodoView() {
  const context = useContext(TodoViewContext);
  if (!context) {
    throw new Error("useTodoView must be used within a TodoViewProvider");
  }
  return context;
}
