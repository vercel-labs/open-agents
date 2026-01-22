import React, { useState, useCallback, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import type { AskUserQuestionInput } from "@open-harness/agent";

type Question = AskUserQuestionInput["questions"][number];

type QuestionPanelProps = {
  questions: Question[];
  toolCallId: string;
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

  // Handle "Other" text selection
  const selectOther = useCallback((question: Question) => {
    setState((prev) => {
      const otherValue = prev.otherText[question.question] || "";
      if (question.multiSelect) {
        // For multi-select, add "Other" as an option if not already selected
        const currentArray = Array.isArray(prev.answers[question.question])
          ? (prev.answers[question.question] as string[])
          : prev.answers[question.question]
            ? [prev.answers[question.question] as string]
            : [];
        // If other text exists and not already in array, we'll add it
        return {
          ...prev,
          typingOther: { ...prev.typingOther, [question.question]: true },
          answers: {
            ...prev.answers,
            [question.question]: otherValue
              ? [...currentArray.filter((a) => a !== otherValue), otherValue]
              : currentArray,
          },
        };
      } else {
        return {
          ...prev,
          typingOther: { ...prev.typingOther, [question.question]: true },
          answers: { ...prev.answers, [question.question]: otherValue },
        };
      }
    });
  }, []);

  // Handle typing in "Other" field
  const handleOtherInput = useCallback((question: string, input: string) => {
    setState((prev) => ({
      ...prev,
      otherText: { ...prev.otherText, [question]: input },
      answers: { ...prev.answers, [question]: input },
    }));
  }, []);

  useInput((input, key) => {
    // Escape to cancel
    if (key.escape) {
      onCancel();
      return;
    }

    // Tab navigation with left/right arrows or Tab key
    const goLeft = key.leftArrow || (key.shift && key.tab);
    const goRight = key.rightArrow || key.tab;

    // If currently typing in "Other" field
    if (currentQuestion && state.typingOther[currentQuestion.question]) {
      if (key.return) {
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
        }
        return;
      }
      if (key.backspace || key.delete) {
        const current = state.otherText[currentQuestion.question] || "";
        handleOtherInput(currentQuestion.question, current.slice(0, -1));
        return;
      }
      if (key.upArrow) {
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
      if (input && !key.ctrl && !key.meta) {
        const current = state.otherText[currentQuestion.question] || "";
        handleOtherInput(currentQuestion.question, current + input);
        return;
      }
      return;
    }

    // Tab navigation
    if (goLeft && !key.shift) {
      goToTab(state.currentTab - 1);
      return;
    }
    if (goRight && !key.shift && !key.tab) {
      goToTab(state.currentTab + 1);
      return;
    }
    if (key.tab) {
      if (key.shift) {
        goToTab(state.currentTab - 1);
      } else {
        goToTab(state.currentTab + 1);
      }
      return;
    }

    // On Submit tab
    if (isSubmitTab) {
      if (key.return && allAnswered) {
        onSubmit(state.answers);
      }
      return;
    }

    // Navigation within question options
    if (!currentQuestion) return;

    const optionsCount = currentQuestion.options.length + 1; // +1 for "Other"
    const currentIndex = state.optionIndex[currentQuestion.question] ?? 0;

    const goUp = key.upArrow || input === "k" || (key.ctrl && input === "p");
    const goDown =
      key.downArrow || input === "j" || (key.ctrl && input === "n");

    if (goUp) {
      const newIndex = currentIndex === 0 ? optionsCount - 1 : currentIndex - 1;
      setState((prev) => ({
        ...prev,
        optionIndex: {
          ...prev.optionIndex,
          [currentQuestion.question]: newIndex,
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
      }));
      return;
    }

    // Enter or Space to select
    if (key.return || input === " ") {
      if (currentIndex < currentQuestion.options.length) {
        // Select a regular option
        const option = currentQuestion.options[currentIndex];
        if (option) {
          selectOption(currentQuestion, option.label);
        }
      } else {
        // Select "Other"
        selectOther(currentQuestion);
      }
      return;
    }

    // Number keys for quick selection (1-4)
    const num = parseInt(input, 10);
    if (num >= 1 && num <= currentQuestion.options.length) {
      const option = currentQuestion.options[num - 1];
      if (option) {
        selectOption(currentQuestion, option.label);
      }
    }
  });

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="single"
      borderTop
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderColor="gray"
      paddingTop={1}
    >
      {/* Tab bar */}
      <Box>
        <Text color="gray">{"← "}</Text>
        {questions.map((q, idx) => {
          const isActive = idx === state.currentTab;
          const hasAnswer = getAnswer(q.question) !== undefined;
          return (
            <Box key={q.question}>
              <Text
                color={isActive ? "yellow" : hasAnswer ? "green" : "gray"}
                bold={isActive}
              >
                {isActive ? "●" : hasAnswer ? "✓" : "○"} {q.header}
              </Text>
              {idx < questions.length - 1 && <Text color="gray"> │ </Text>}
            </Box>
          );
        })}
        <Text color="gray"> │ </Text>
        <Text
          color={isSubmitTab ? "yellow" : allAnswered ? "green" : "gray"}
          bold={isSubmitTab}
        >
          {isSubmitTab ? "●" : allAnswered ? "✓" : "○"} Submit
        </Text>
        <Text color="gray">{" →"}</Text>
      </Box>

      {/* Content area */}
      <Box flexDirection="column" marginTop={1}>
        {isSubmitTab ? (
          // Submit tab: show review
          <Box flexDirection="column">
            <Text color="blueBright" bold>
              Review your answers
            </Text>
            <Box flexDirection="column" marginTop={1} marginLeft={2}>
              {questions.map((q) => {
                const answer = getAnswer(q.question);
                const answerStr = Array.isArray(answer)
                  ? answer.join(", ")
                  : answer || "(not answered)";
                return (
                  <Box key={q.question} flexDirection="column" marginBottom={1}>
                    <Text color="white">{q.question}</Text>
                    <Text color="gray"> → {answerStr}</Text>
                  </Box>
                );
              })}
            </Box>
            {allAnswered ? (
              <Box marginTop={1}>
                <Text color="green">Press Enter to submit</Text>
              </Box>
            ) : (
              <Box marginTop={1}>
                <Text color="yellow">
                  Please answer all questions before submitting
                </Text>
              </Box>
            )}
          </Box>
        ) : currentQuestion ? (
          // Question tab
          <Box flexDirection="column">
            <Text color="blueBright" bold>
              {currentQuestion.question}
            </Text>
            <Box flexDirection="column" marginTop={1}>
              {currentQuestion.options.map((option, idx) => {
                const currentIndex =
                  state.optionIndex[currentQuestion.question] ?? 0;
                const isHighlighted = idx === currentIndex;
                const answer = getAnswer(currentQuestion.question);
                const isSelected = currentQuestion.multiSelect
                  ? Array.isArray(answer) && answer.includes(option.label)
                  : answer === option.label;

                return (
                  <Box key={option.label} flexDirection="column">
                    <Box>
                      <Text color="yellow">{isHighlighted ? "› " : "  "}</Text>
                      <Text color={isSelected ? "green" : "gray"}>
                        {currentQuestion.multiSelect
                          ? isSelected
                            ? "[✓]"
                            : "[ ]"
                          : isSelected
                            ? "(●)"
                            : "( )"}
                      </Text>
                      <Text> </Text>
                      <Text
                        color={
                          isHighlighted
                            ? "yellow"
                            : isSelected
                              ? "green"
                              : undefined
                        }
                        bold={isHighlighted}
                      >
                        {idx + 1}. {option.label}
                      </Text>
                    </Box>
                    {option.description && (
                      <Box marginLeft={6}>
                        <Text color="gray">{option.description}</Text>
                      </Box>
                    )}
                  </Box>
                );
              })}
              {/* "Other" option */}
              <Box flexDirection="column">
                <Box>
                  <Text color="yellow">
                    {(state.optionIndex[currentQuestion.question] ?? 0) ===
                    currentQuestion.options.length
                      ? "› "
                      : "  "}
                  </Text>
                  <Text color="gray">
                    {currentQuestion.multiSelect ? "[ ]" : "( )"}
                  </Text>
                  <Text> </Text>
                  {state.typingOther[currentQuestion.question] ? (
                    <>
                      <Text color="yellow">
                        {state.otherText[currentQuestion.question] || ""}
                      </Text>
                      <Text color="gray">█</Text>
                    </>
                  ) : state.otherText[currentQuestion.question] ? (
                    <Text color="gray">
                      {state.otherText[currentQuestion.question]}
                    </Text>
                  ) : (
                    <Text color="gray">Type something else...</Text>
                  )}
                </Box>
              </Box>
            </Box>
          </Box>
        ) : null}
      </Box>

      {/* Footer hint */}
      <Box marginTop={1}>
        <Text color="gray">
          {state.typingOther[currentQuestion?.question ?? ""]
            ? "Type your answer · Enter to confirm · ↑ to go back"
            : "Tab/←→ navigate tabs · ↑↓ navigate options · Enter/Space select · Esc cancel"}
        </Text>
      </Box>
    </Box>
  );
}
