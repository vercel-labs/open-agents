"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AskUserQuestionInput } from "@open-harness/agent";

type Question = AskUserQuestionInput["questions"][number];

type QuestionPanelProps = {
  questions: Question[];
  onSubmit: (answers: Record<string, string | string[]>) => void;
  onCancel: () => void;
};

type TabState = {
  currentTab: number;
  answers: Record<string, string | string[]>;
  otherText: Record<string, string>;
  typingOther: Record<string, boolean>;
};

export function QuestionPanel({
  questions,
  onSubmit,
  onCancel,
}: QuestionPanelProps) {
  const totalTabs = questions.length + 1; // Questions + Submit tab

  const [state, setState] = useState<TabState>(() => ({
    currentTab: 0,
    answers: {},
    otherText: {},
    typingOther: {},
  }));

  // Ref to track current tab for setTimeout callbacks (avoids stale closure)
  const currentTabRef = useRef(state.currentTab);
  useEffect(() => {
    currentTabRef.current = state.currentTab;
  }, [state.currentTab]);

  const currentQuestion = questions[state.currentTab] as Question | undefined;
  const isSubmitTab = state.currentTab === questions.length;

  // Computed values for "Other" option
  const otherText = currentQuestion
    ? state.otherText[currentQuestion.question] || ""
    : "";
  const currentAnswer = currentQuestion
    ? state.answers[currentQuestion.question]
    : undefined;
  const isOtherSelected = currentQuestion
    ? currentQuestion.multiSelect
      ? Array.isArray(currentAnswer) &&
        otherText !== "" &&
        currentAnswer.includes(otherText)
      : currentAnswer === otherText && otherText !== ""
    : false;

  // Get current answer for a question
  const getAnswer = useCallback(
    (question: string): string | string[] | undefined => {
      return state.answers[question];
    },
    [state.answers],
  );

  // Check if all questions have answers
  const allAnswered = useMemo(() => {
    return questions.every((q) => {
      const answer = getAnswer(q.question);
      return (
        answer !== undefined &&
        (Array.isArray(answer) ? answer.length > 0 : answer !== "")
      );
    });
  }, [questions, getAnswer]);

  // Handle tab navigation
  const goToTab = useCallback(
    (index: number) => {
      setState((prev) => ({
        ...prev,
        currentTab: Math.max(0, Math.min(index, totalTabs - 1)),
      }));
    },
    [totalTabs],
  );

  // Handle option selection
  const selectOption = useCallback(
    (question: Question, optionLabel: string, autoAdvance = true) => {
      setState((prev) => {
        const currentAnswer = prev.answers[question.question];

        if (question.multiSelect) {
          // Multi-select: toggle the option
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
            typingOther: { ...prev.typingOther, [question.question]: false },
          };
        } else {
          // Single select: replace
          return {
            ...prev,
            answers: { ...prev.answers, [question.question]: optionLabel },
            typingOther: { ...prev.typingOther, [question.question]: false },
          };
        }
      });

      // Auto-advance for single-select only (use ref to avoid stale closure)
      if (autoAdvance && !question.multiSelect) {
        setTimeout(() => goToTab(currentTabRef.current + 1), 150);
      }
    },
    [goToTab],
  );

  // Handle "Other" text change
  const handleOtherInput = useCallback(
    (question: string, input: string) => {
      setState((prev) => {
        const newOtherText = { ...prev.otherText, [question]: input };
        const newAnswers = { ...prev.answers };
        const currentAnswer = prev.answers[question];
        const previousOther = prev.otherText[question] || "";

        const questionObj = questions.find((q) => q.question === question);

        if (questionObj?.multiSelect) {
          const currentArray = Array.isArray(currentAnswer)
            ? currentAnswer
            : currentAnswer
              ? [currentAnswer]
              : [];
          let updatedArray = currentArray.filter((a) => a !== previousOther);
          if (input) {
            updatedArray = [...updatedArray, input];
          }
          if (updatedArray.length > 0) {
            newAnswers[question] = updatedArray;
          } else {
            delete newAnswers[question];
          }
        } else {
          if (input) {
            newAnswers[question] = input;
          } else {
            delete newAnswers[question];
          }
        }

        return {
          ...prev,
          otherText: newOtherText,
          answers: newAnswers,
          typingOther: { ...prev.typingOther, [question]: true },
        };
      });
    },
    [questions],
  );

  // Confirm "Other" text and advance
  const confirmOther = useCallback(
    (question: Question) => {
      const otherValue = state.otherText[question.question] || "";
      if (otherValue) {
        setState((prev) => ({
          ...prev,
          typingOther: { ...prev.typingOther, [question.question]: false },
        }));
        if (!question.multiSelect) {
          goToTab(state.currentTab + 1);
        }
      }
    },
    [goToTab, state.currentTab, state.otherText],
  );

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if we're typing in the Other field
      const isTypingOther =
        currentQuestion && state.typingOther[currentQuestion.question];
      if (isTypingOther) return;

      // Escape to cancel
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }

      // Left/Right arrow for tab navigation
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToTab(state.currentTab - 1);
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goToTab(state.currentTab + 1);
        return;
      }

      // Number keys for quick selection (1-4)
      if (currentQuestion && !isSubmitTab) {
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= currentQuestion.options.length) {
          const option = currentQuestion.options[num - 1];
          if (option) {
            e.preventDefault();
            selectOption(currentQuestion, option.label);
          }
        }
      }

      // Enter to submit on submit tab
      if (isSubmitTab && e.key === "Enter" && allAnswered) {
        e.preventDefault();
        onSubmit(state.answers);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    currentQuestion,
    isSubmitTab,
    allAnswered,
    state.currentTab,
    state.typingOther,
    state.answers,
    goToTab,
    onCancel,
    onSubmit,
    selectOption,
  ]);

  return (
    <div className="px-4 py-4">
      <div className="mx-auto max-w-3xl rounded-lg border border-border bg-card p-4">
        {/* Tab bar */}
        <div className="mb-4 flex items-center gap-1 overflow-x-auto">
          {questions.map((q, idx) => {
            const isActive = idx === state.currentTab;
            const hasAnswer = getAnswer(q.question) !== undefined;
            return (
              <button
                key={q.question}
                type="button"
                onClick={() => goToTab(idx)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : hasAnswer
                      ? "bg-green-500/10 text-green-500 hover:bg-green-500/20"
                      : "bg-muted text-muted-foreground hover:bg-accent",
                )}
              >
                {hasAnswer && <Check className="h-3 w-3" />}
                {q.header}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => goToTab(questions.length)}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors",
              isSubmitTab
                ? "bg-primary text-primary-foreground"
                : allAnswered
                  ? "bg-green-500/10 text-green-500 hover:bg-green-500/20"
                  : "bg-muted text-muted-foreground hover:bg-accent",
            )}
          >
            {allAnswered && <Check className="h-3 w-3" />}
            Submit
          </button>
        </div>

        {/* Content area */}
        <div className="min-h-[200px]">
          {isSubmitTab ? (
            // Submit tab: review answers
            <div>
              <h3 className="mb-3 font-medium text-foreground">
                Review your answers
              </h3>
              <div className="space-y-3">
                {questions.map((q) => {
                  const answer = getAnswer(q.question);
                  const answerStr = Array.isArray(answer)
                    ? answer.join(", ")
                    : answer || "(not answered)";
                  return (
                    <div key={q.question} className="space-y-1">
                      <p className="text-sm text-foreground">{q.question}</p>
                      <p className="text-sm text-muted-foreground">
                        <span className="text-green-500">&rarr;</span>{" "}
                        {answerStr}
                      </p>
                    </div>
                  );
                })}
              </div>
              {!allAnswered && (
                <p className="mt-4 text-sm text-yellow-500">
                  Please answer all questions before submitting
                </p>
              )}
            </div>
          ) : currentQuestion ? (
            // Question tab
            <div>
              <h3 className="mb-4 font-medium text-foreground">
                {currentQuestion.question}
              </h3>
              <div className="space-y-2">
                {currentQuestion.options.map((option, idx) => {
                  const answer = getAnswer(currentQuestion.question);
                  const isSelected = currentQuestion.multiSelect
                    ? Array.isArray(answer) && answer.includes(option.label)
                    : answer === option.label;

                  return (
                    <button
                      key={option.label}
                      type="button"
                      onClick={() =>
                        selectOption(currentQuestion, option.label)
                      }
                      className={cn(
                        "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                        isSelected
                          ? "border-green-500 bg-green-500/10"
                          : "border-border hover:border-primary hover:bg-accent",
                      )}
                    >
                      <div
                        className={cn(
                          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                          isSelected
                            ? "border-green-500 bg-green-500"
                            : "border-muted-foreground",
                        )}
                      >
                        {isSelected && (
                          <Check className="h-3 w-3 text-primary-foreground" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {idx + 1}.
                          </span>
                          <span
                            className={cn(
                              "font-medium",
                              isSelected ? "text-green-500" : "text-foreground",
                            )}
                          >
                            {option.label}
                          </span>
                        </div>
                        {option.description && (
                          <p className="mt-1 text-sm text-muted-foreground">
                            {option.description}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })}

                {/* "Other" option */}
                <div
                  className={cn(
                    "rounded-lg border p-3 transition-colors",
                    isOtherSelected
                      ? "border-green-500 bg-green-500/10"
                      : "border-border",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                        isOtherSelected
                          ? "border-green-500 bg-green-500"
                          : "border-muted-foreground",
                      )}
                    >
                      {isOtherSelected && (
                        <Check className="h-3 w-3 text-primary-foreground" />
                      )}
                    </div>
                    <Input
                      type="text"
                      placeholder="Type something else..."
                      value={otherText}
                      onChange={(e) =>
                        handleOtherInput(
                          currentQuestion.question,
                          e.target.value,
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          confirmOther(currentQuestion);
                        }
                      }}
                      className="flex-1 border-0 bg-transparent px-2 py-0 focus-visible:ring-0"
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="hidden text-xs text-muted-foreground sm:block">
            1-4 select option &middot; Esc cancel
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel}>
              <X className="mr-1 h-4 w-4" />
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => onSubmit(state.answers)}
              disabled={!allAnswered}
            >
              <Check className="mr-1 h-4 w-4" />
              Submit
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
