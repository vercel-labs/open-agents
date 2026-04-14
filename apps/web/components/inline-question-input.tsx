"use client";

import {
  useState,
  useCallback,
  useMemo,
  useEffect,
  type ReactNode,
} from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AskUserQuestionInput } from "@open-harness/agent";

type Question = AskUserQuestionInput["questions"][number];

type UseInlineQuestionOptions = {
  questions: Question[];
  onSubmit: (answers: Record<string, string | string[]>) => void;
  onCancel: () => void;
  textareaValue: string;
  onTextareaChange: (value: string) => void;
};

type QuestionState = {
  currentIndex: number;
  answers: Record<string, string | string[]>;
};

export function useInlineQuestion({
  questions,
  onSubmit,
  onCancel,
  textareaValue,
  onTextareaChange,
}: UseInlineQuestionOptions) {
  const [state, setState] = useState<QuestionState>(() => ({
    currentIndex: 0,
    answers: {},
  }));

  const isActive = questions.length > 0;
  const currentQuestion = questions[state.currentIndex] as Question | undefined;
  const isLastQuestion = state.currentIndex >= questions.length - 1;

  const currentAnswer = currentQuestion
    ? state.answers[currentQuestion.question]
    : undefined;

  const selectOption = useCallback(
    (question: Question, optionLabel: string) => {
      setState((prev) => {
        const currentAnswer = prev.answers[question.question];

        if (question.multiSelect) {
          const currentArray = Array.isArray(currentAnswer)
            ? currentAnswer
            : currentAnswer
              ? [currentAnswer]
              : [];
          const exists = currentArray.includes(optionLabel);
          const newArray = exists
            ? currentArray.filter((a) => a !== optionLabel)
            : [...currentArray, optionLabel];
          return {
            ...prev,
            answers: { ...prev.answers, [question.question]: newArray },
          };
        } else {
          return {
            ...prev,
            answers: { ...prev.answers, [question.question]: optionLabel },
          };
        }
      });
      if (!question.multiSelect) {
        onTextareaChange("");
      }
    },
    [onTextareaChange],
  );

  const hasCurrentAnswer = useMemo(() => {
    if (!currentQuestion) return false;
    const customText = textareaValue.trim();
    if (customText) return true;
    const answer = state.answers[currentQuestion.question];
    return (
      answer !== undefined &&
      (Array.isArray(answer) ? answer.length > 0 : answer !== "")
    );
  }, [currentQuestion, textareaValue, state.answers]);

  const handleNext = useCallback(() => {
    if (!currentQuestion) return;

    const customText = textareaValue.trim();
    let finalAnswers = { ...state.answers };

    if (customText) {
      finalAnswers[currentQuestion.question] = customText;
      setState((prev) => ({
        ...prev,
        answers: finalAnswers,
      }));
      onTextareaChange("");
    }

    const answer = finalAnswers[currentQuestion.question];
    const hasAnswer =
      answer !== undefined &&
      (Array.isArray(answer) ? answer.length > 0 : answer !== "");

    if (!hasAnswer) return;

    if (isLastQuestion) {
      onSubmit(finalAnswers);
    } else {
      setState((prev) => ({
        ...prev,
        currentIndex: prev.currentIndex + 1,
        answers: finalAnswers,
      }));
      onTextareaChange("");
    }
  }, [
    currentQuestion,
    textareaValue,
    state.answers,
    isLastQuestion,
    onSubmit,
    onTextareaChange,
  ]);

  const buttonLabel = isLastQuestion ? "Submit answers" : "Next question";
  const compactButtonLabel = isLastQuestion ? "Submit" : "Next";

  const placeholder =
    "Type your own answer, or leave this blank to use the selected option";

  // Escape to cancel (only when active)
  useEffect(() => {
    if (!isActive) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isActive, onCancel]);

  // Reset state when questions change (skip stable empty array)
  const questionsKey = questions.map((q) => q.question).join("\0");
  useEffect(() => {
    if (questions.length > 0) {
      setState({ currentIndex: 0, answers: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionsKey]);

  const questionHeaderUI: ReactNode = currentQuestion ? (
    <div className="space-y-2.5 px-4 pt-3">
      {/* Question counter + label + cancel */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="shrink-0 font-mono text-xs font-medium text-muted-foreground">
            {state.currentIndex + 1}/{questions.length}
          </span>
          <span className="shrink-0 font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/70">
            {currentQuestion.header}
          </span>
          <span className="text-sm text-foreground">
            {currentQuestion.question}
          </span>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Option pills */}
      <div className="flex flex-wrap gap-1.5">
        {currentQuestion.options.map((option) => {
          const isSelected = currentQuestion.multiSelect
            ? Array.isArray(currentAnswer) &&
              currentAnswer.includes(option.label)
            : currentAnswer === option.label;

          return (
            <button
              key={option.label}
              type="button"
              onClick={() => selectOption(currentQuestion, option.label)}
              title={option.description || undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-all",
                isSelected
                  ? "border-primary bg-primary/10 font-medium text-primary"
                  : "border-border bg-background text-foreground hover:border-primary/50 hover:bg-accent",
              )}
            >
              {isSelected && <Check className="h-3 w-3" />}
              {option.label}
            </button>
          );
        })}
      </div>

      {/* Progress dots for multi-question */}
      {questions.length > 1 && (
        <div className="flex items-center gap-1">
          {questions.map((q, idx) => {
            const answered = state.answers[q.question] !== undefined;
            const isCurrent = idx === state.currentIndex;
            return (
              <div
                key={q.question}
                className={cn(
                  "h-1 rounded-full transition-all",
                  isCurrent
                    ? "w-4 bg-primary"
                    : answered
                      ? "w-1.5 bg-primary/50"
                      : "w-1.5 bg-muted-foreground/30",
                )}
              />
            );
          })}
        </div>
      )}
    </div>
  ) : null;

  return {
    isActive,
    questionHeaderUI: isActive ? questionHeaderUI : null,
    handleNext,
    hasCurrentAnswer,
    buttonLabel,
    compactButtonLabel,
    placeholder,
  };
}
