import type { AskUserQuestionInput } from "@open-harness/agent";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import React, { useCallback, useMemo, useState } from "react";
import { PRIMARY_COLOR } from "../lib/colors";
import { inputFromKey, isReturnKey } from "../lib/keyboard";

type Question = AskUserQuestionInput["questions"][number];

type QuestionPanelProps = {
  questions: Question[];
  onSubmit: (answers: Record<string, string | string[]>) => void;
  onCancel: () => void;
};

type TabState = {
  // Current tab index (0 to questions.length, last is Submit)
  currentTab: number;
  // Answers per question: question text -> selected option(s)
  answers: Record<string, string | string[]>;
  // "Other" text input per question
  otherText: Record<string, string>;
  // Current option selection per question (for navigation within question)
  optionIndex: Record<string, number>;
  // Whether we're typing in "other" mode
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
    optionIndex: Object.fromEntries(questions.map((q) => [q.question, 0])),
    typingOther: {},
  }));

  const currentQuestion = questions[state.currentTab] as Question | undefined;
  const isSubmitTab = state.currentTab === questions.length;

  // Computed values for "Other" option in current question
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
  const isOtherHighlighted = currentQuestion
    ? (state.optionIndex[currentQuestion.question] ?? 0) ===
      currentQuestion.options.length
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
    (question: Question, optionLabel: string) => {
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
    },
    [],
  );

  // Handle "Other" text selection - only enter typing mode, don't save empty values
  const selectOther = useCallback((question: Question) => {
    setState((prev) => {
      const otherValue = prev.otherText[question.question] || "";
      if (question.multiSelect) {
        // For multi-select, only add to answers if there's actual text
        const currentArray = Array.isArray(prev.answers[question.question])
          ? (prev.answers[question.question] as string[])
          : prev.answers[question.question]
            ? [prev.answers[question.question] as string]
            : [];
        return {
          ...prev,
          typingOther: { ...prev.typingOther, [question.question]: true },
          // Only include otherValue in answers if it's non-empty
          answers: otherValue
            ? {
                ...prev.answers,
                [question.question]: [
                  ...currentArray.filter((a) => a !== otherValue),
                  otherValue,
                ],
              }
            : prev.answers,
        };
      } else {
        // For single-select, only enter typing mode without setting empty answer
        return {
          ...prev,
          typingOther: { ...prev.typingOther, [question.question]: true },
          // Only set answer if there's actual text
          answers: otherValue
            ? { ...prev.answers, [question.question]: otherValue }
            : prev.answers,
        };
      }
    });
  }, []);

  // Handle typing in "Other" field - only save non-empty values as answers
  const handleOtherInput = useCallback(
    (question: string, input: string) => {
      setState((prev) => {
        // Always update otherText to track what user typed
        const newOtherText = { ...prev.otherText, [question]: input };
        const newAnswers = { ...prev.answers };
        const currentAnswer = prev.answers[question];
        const previousOther = prev.otherText[question] || "";

        // Check if this question is multi-select
        const questionObj = questions.find((q) => q.question === question);

        if (questionObj?.multiSelect) {
          // Multi-select: only remove/update the "Other" value, preserve other selections
          const currentArray = Array.isArray(currentAnswer)
            ? currentAnswer
            : currentAnswer
              ? [currentAnswer]
              : [];
          let updatedArray = currentArray.filter((a) => a !== previousOther);
          if (input) {
            updatedArray = [...updatedArray, input];
          }
          // Only keep answer if array has items
          if (updatedArray.length > 0) {
            newAnswers[question] = updatedArray;
          } else {
            delete newAnswers[question];
          }
        } else {
          // Single-select: replace or remove the answer
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
        };
      });
    },
    [questions],
  );

  useKeyboard((event) => {
    const input = inputFromKey(event);
    // Escape to cancel
    if (event.name === "escape") {
      onCancel();
      return;
    }

    // If currently typing in "Other" field
    if (currentQuestion && state.typingOther[currentQuestion.question]) {
      if (isReturnKey(event)) {
        // Exit typing mode and confirm the other text
        const otherValue = state.otherText[currentQuestion.question] || "";
        if (otherValue) {
          setState((prev) => ({
            ...prev,
            typingOther: {
              ...prev.typingOther,
              [currentQuestion.question]: false,
            },
          }));
          // Auto-advance to next tab after confirming "Other" text (single-select only)
          if (!currentQuestion.multiSelect) {
            goToTab(state.currentTab + 1);
          }
        }
        return;
      }
      if (event.name === "backspace" || event.name === "delete") {
        const current = state.otherText[currentQuestion.question] || "";
        handleOtherInput(currentQuestion.question, current.slice(0, -1));
        return;
      }
      if (event.name === "up") {
        // Exit typing mode and go back to options
        setState((prev) => ({
          ...prev,
          typingOther: {
            ...prev.typingOther,
            [currentQuestion.question]: false,
          },
        }));
        return;
      }
      if (input && !event.ctrl && !event.meta) {
        const current = state.otherText[currentQuestion.question] || "";
        handleOtherInput(currentQuestion.question, current + input);
        return;
      }
      return;
    }

    // Arrow key navigation between tabs
    if (event.name === "left") {
      goToTab(state.currentTab - 1);
      return;
    }
    if (event.name === "right") {
      goToTab(state.currentTab + 1);
      return;
    }

    // Tab key navigation
    if (event.name === "tab") {
      if (event.shift) {
        goToTab(state.currentTab - 1);
      } else {
        goToTab(state.currentTab + 1);
      }
      return;
    }

    // On Submit tab
    if (isSubmitTab) {
      if (isReturnKey(event) && allAnswered) {
        onSubmit(state.answers);
      }
      return;
    }

    // Navigation within question options
    if (!currentQuestion) return;

    const optionsCount = currentQuestion.options.length + 1; // +1 for "Other"
    const currentIndex = state.optionIndex[currentQuestion.question] ?? 0;

    const goUp =
      event.name === "up" || input === "k" || (event.ctrl && input === "p");
    const goDown =
      event.name === "down" || input === "j" || (event.ctrl && input === "n");

    if (goUp) {
      const newIndex = currentIndex === 0 ? optionsCount - 1 : currentIndex - 1;
      setState((prev) => ({
        ...prev,
        optionIndex: {
          ...prev.optionIndex,
          [currentQuestion.question]: newIndex,
        },
        typingOther: {
          ...prev.typingOther,
          [currentQuestion.question]: newIndex === optionsCount - 1,
        },
      }));
      return;
    }

    if (goDown) {
      const newIndex = currentIndex === optionsCount - 1 ? 0 : currentIndex + 1;
      setState((prev) => ({
        ...prev,
        optionIndex: {
          ...prev.optionIndex,
          [currentQuestion.question]: newIndex,
        },
        typingOther: {
          ...prev.typingOther,
          [currentQuestion.question]: newIndex === optionsCount - 1,
        },
      }));
      return;
    }

    // Enter or Space to select
    if (isReturnKey(event) || input === " ") {
      if (currentIndex < currentQuestion.options.length) {
        // Select a regular option
        const option = currentQuestion.options[currentIndex];
        if (option) {
          selectOption(currentQuestion, option.label);
          // For single-select, auto-advance to next tab on selection
          // For multi-select, only advance on Enter (not Space which toggles)
          if (!currentQuestion.multiSelect || isReturnKey(event)) {
            goToTab(state.currentTab + 1);
          }
        }
      } else {
        // Select "Other" - enter typing mode, don't advance yet
        selectOther(currentQuestion);
      }
      return;
    }

    // Number keys for quick selection (1-4)
    const num = parseInt(input, 10);
    if (num >= 1 && num <= optionsCount) {
      if (num === optionsCount) {
        setState((prev) => ({
          ...prev,
          optionIndex: {
            ...prev.optionIndex,
            [currentQuestion.question]: optionsCount - 1,
          },
          typingOther: {
            ...prev.typingOther,
            [currentQuestion.question]: true,
          },
        }));
        return;
      }

      const option = currentQuestion.options[num - 1];
      if (option) {
        selectOption(currentQuestion, option.label);
        // Auto-advance for single-select only (number keys act like quick toggle for multi-select)
        if (!currentQuestion.multiSelect) {
          goToTab(state.currentTab + 1);
        }
      }
    }
  });

  return (
    <box
      flexDirection="column"
      marginTop={1}
      borderStyle="single"
      border={["top"]}
      borderColor="gray"
      paddingTop={1}
    >
      {/* Tab bar */}
      <box flexDirection="row">
        <text>
          {questions.map((q, idx) => {
            const isActive = idx === state.currentTab;
            const hasAnswer = getAnswer(q.question) !== undefined;
            return (
              <React.Fragment key={q.question}>
                <span
                  fg={isActive ? PRIMARY_COLOR : hasAnswer ? "green" : "gray"}
                  attributes={isActive ? TextAttributes.BOLD : undefined}
                >
                  {q.header}
                </span>
                {idx < questions.length - 1 && <span fg="gray"> · </span>}
              </React.Fragment>
            );
          })}
          <span fg="gray"> · </span>
          <span
            fg={isSubmitTab ? PRIMARY_COLOR : allAnswered ? "green" : "gray"}
            bg="#232a31"
            attributes={isSubmitTab ? TextAttributes.BOLD : undefined}
          >
            {" Submit "}
          </span>
        </text>
      </box>

      {/* Content area */}
      <box flexDirection="column" marginTop={1}>
        {isSubmitTab ? (
          // Submit tab: show review
          <box flexDirection="column">
            <text fg="white" attributes={TextAttributes.BOLD}>
              Review your answers
            </text>
            <box flexDirection="column" marginTop={1} marginLeft={2}>
              {questions.map((q) => {
                const answer = getAnswer(q.question);
                const answerStr = Array.isArray(answer)
                  ? answer.join(", ")
                  : answer || "(not answered)";
                return (
                  <box key={q.question} flexDirection="column" marginBottom={1}>
                    <text fg="white">{q.question}</text>
                    <text fg="gray">: {answerStr}</text>
                  </box>
                );
              })}
            </box>
            {allAnswered ? (
              <box marginTop={1}>
                <text fg="green">Press Enter to submit</text>
              </box>
            ) : (
              <box marginTop={1}>
                <text fg={PRIMARY_COLOR}>
                  Please answer all questions before submitting
                </text>
              </box>
            )}
          </box>
        ) : currentQuestion ? (
          // Question tab
          <box flexDirection="column">
            <text fg="white" attributes={TextAttributes.BOLD}>
              {currentQuestion.question}
            </text>
            <box flexDirection="column" marginTop={1}>
              {currentQuestion.options.map((option, idx) => {
                const currentIndex =
                  state.optionIndex[currentQuestion.question] ?? 0;
                const isHighlighted = idx === currentIndex;
                const answer = getAnswer(currentQuestion.question);
                const isSelected = currentQuestion.multiSelect
                  ? Array.isArray(answer) && answer.includes(option.label)
                  : answer === option.label;

                return (
                  <box key={option.label} flexDirection="column">
                    <box flexDirection="row">
                      <text fg={isSelected ? "green" : "gray"}>
                        {isSelected ? "✓ " : "  "}
                      </text>
                      <text
                        fg={
                          isHighlighted
                            ? PRIMARY_COLOR
                            : isSelected
                              ? "green"
                              : undefined
                        }
                        attributes={
                          isHighlighted ? TextAttributes.BOLD : undefined
                        }
                      >
                        {idx + 1}. {option.label}
                      </text>
                    </box>
                    {option.description && (
                      <box marginLeft={6}>
                        <text fg="gray">{option.description}</text>
                      </box>
                    )}
                  </box>
                );
              })}
              {/* "Other" option */}
              <box flexDirection="column">
                <box flexDirection="row">
                  <text fg={isOtherSelected ? "green" : "gray"}>
                    {isOtherSelected ? "✓ " : "  "}
                  </text>
                  <text
                    fg={isOtherHighlighted ? PRIMARY_COLOR : undefined}
                    attributes={
                      isOtherHighlighted ? TextAttributes.BOLD : undefined
                    }
                  >
                    {currentQuestion.options.length + 1}.
                  </text>
                  {state.typingOther[currentQuestion.question] || otherText ? (
                    <>
                      {otherText && <text> </text>}
                      <text
                        fg={
                          state.typingOther[currentQuestion.question]
                            ? PRIMARY_COLOR
                            : isOtherSelected
                              ? "green"
                              : "gray"
                        }
                      >
                        {otherText}
                      </text>
                      {state.typingOther[currentQuestion.question] && (
                        <text fg="gray">█</text>
                      )}
                    </>
                  ) : (
                    <text fg="gray"> Type something else...</text>
                  )}
                </box>
              </box>
            </box>
          </box>
        ) : null}
      </box>

      {/* Footer hint */}
      <box marginTop={1}>
        <text fg="gray">
          {state.typingOther[currentQuestion?.question ?? ""]
            ? "Type your answer · Enter to confirm · ↑ to go back"
            : "Tab/←→ navigate tabs · ↑↓ navigate options · Enter/Space select · Esc cancel"}
        </text>
      </box>
    </box>
  );
}
