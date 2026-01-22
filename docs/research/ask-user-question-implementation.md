# AskUserQuestion Implementation Deep Dive

This document provides a comprehensive analysis of the AskUserQuestion tool implementation in Claude Code, intended for recreating this functionality in another application.

## Overview

The AskUserQuestion tool provides a structured way for the AI to gather user input through multiple-choice questions during execution. It's built on React (Ink for terminal UI) and uses Zod for schema validation.

---

## 1. Schema Definition

### Input Schema

```typescript
interface AskUserQuestionInput {
  questions: Array<{
    question: string;        // Full question text, ends with "?"
    header: string;          // Short label (max 12 chars) for chip/tag display
    options: Array<{
      label: string;         // 1-5 words, concise choice text
      description: string;   // Explanation of trade-offs/implications
    }>;                      // 2-4 options required
    multiSelect: boolean;    // Allow multiple selections
  }>;                        // 1-4 questions allowed
  answers?: Record<string, string>;  // Question text → answer mapping
  metadata?: {
    source?: string;         // Analytics tracking (e.g., "remember")
  };
}
```

### Output Schema

```typescript
interface AskUserQuestionOutput {
  questions: QuestionDefinition[];
  answers: Record<string, string>;  // Multi-select: comma-separated values
}
```

---

## 2. Tool Configuration

```typescript
const AskUserQuestionTool = {
  name: "AskUserQuestion",
  maxResultSizeChars: 100000,

  // Behavioral flags
  isEnabled: () => true,
  isConcurrencySafe: () => true,      // Safe with parallel tool calls
  isReadOnly: () => true,              // No side effects
  requiresUserInteraction: () => true, // Always prompts user

  // Permission handling
  checkPermissions: (input) => ({
    behavior: "ask",
    message: "Answer questions?",
    updatedInput: input
  }),

  // Core execution
  call: async (input) => ({
    data: {
      questions: input.questions,
      answers: input.answers ?? {}
    }
  }),

  // Format result for model consumption
  mapToolResultToToolResultBlockParam: (result, toolUseId) => ({
    type: "tool_result",
    tool_use_id: toolUseId,
    content: formatAnswersForModel(result.answers)
  })
};
```

---

## 3. Validation Logic

```typescript
import { z } from "zod";

// Zod schema with custom refinement
const questionSchema = z.object({
  question: z.string(),
  header: z.string().max(12),
  options: z.array(z.object({
    label: z.string(),
    description: z.string()
  })).min(2).max(4),
  multiSelect: z.boolean().default(false)
});

const inputSchema = z.object({
  questions: z.array(questionSchema).min(1).max(4),
  answers: z.record(z.string()).optional(),
  metadata: z.object({
    source: z.string().optional()
  }).optional()
}).refine((data) => {
  // Ensure unique question texts
  const texts = data.questions.map(q => q.question);
  if (texts.length !== new Set(texts).size) return false;

  // Ensure unique option labels within each question
  for (const question of data.questions) {
    const labels = question.options.map(o => o.label);
    if (labels.length !== new Set(labels).size) return false;
  }
  return true;
});
```

---

## 4. React Components

### Answer Display Component (shown after user responds)

```tsx
function AnswerDisplay({ answers }: { answers: Record<string, string> }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row">
        <Text color="green">✓ </Text>
        <Text>User answered Claude's questions:</Text>
      </Box>
      <Box flexDirection="column">
        {Object.entries(answers).map(([question, answer]) => (
          <Text key={question} color="gray">
            · {question} → {answer}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
```

### Rejection Display

```tsx
function RejectionDisplay() {
  return (
    <Box flexDirection="row" marginTop={1}>
      <Text color="green">✓ </Text>
      <Text>User declined to answer questions</Text>
    </Box>
  );
}
```

---

## 5. Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                          MODEL                                       │
│  Calls AskUserQuestion with questions array                         │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     PERMISSION CHECK                                 │
│  checkPermissions() → { behavior: "ask", message: "Answer?" }       │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     TERMINAL UI (React/Ink)                          │
│                                                                      │
│  ? Auth method                                                       │
│    Which authentication method should we use?                        │
│                                                                      │
│    ◯ JWT (Recommended) - Stateless, scalable                        │
│    ◉ OAuth2 - Third-party integration                               │
│    ◯ Session-based - Traditional server-side                        │
│    ◯ Other...                                                        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     USER SELECTION                                   │
│  Keyboard navigation → Select option(s) → Submit                    │
│  "Other" option → Free text input                                   │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     TOOL CALL EXECUTION                              │
│  call() returns: { questions, answers }                             │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     RESULT MAPPING                                   │
│  mapToolResultToToolResultBlockParam() formats for model:           │
│  "User has answered: \"Question?\"=\"Answer\", ..."                 │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          MODEL                                       │
│  Receives formatted answers, continues with user preferences         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 6. Result Formatting for Model

```typescript
function formatAnswersForModel(answers: Record<string, string>): string {
  const formatted = Object.entries(answers)
    .map(([question, answer]) => `"${question}"="${answer}"`)
    .join(", ");

  return `User has answered your questions: ${formatted}. ` +
         `You can now continue with the user's answers in mind.`;
}
```

### Example output

```
User has answered your questions: "Which database should we use?"="PostgreSQL",
"Should we add caching?"="Yes, with Redis". You can now continue with the
user's answers in mind.
```

---

## 7. Key Implementation Details

| Aspect | Implementation |
|--------|----------------|
| **UI Framework** | React with Ink (terminal rendering) |
| **Validation** | Zod schemas with custom refinements |
| **Answer Storage** | `Record<string, string>` (question text → answer) |
| **Multi-select** | Comma-separated values in answer string |
| **"Other" Option** | Automatically appended to all questions |
| **Concurrency** | Safe to run with parallel tool calls |
| **Permission Model** | Always asks user (`behavior: "ask"`) |

---

## 8. Recreating in Another Application

### Essential components to implement

1. **Schema validation** - Use Zod or similar for input validation
2. **Question renderer** - Build UI component that displays:
   - Header as chip/tag
   - Question text
   - Selectable options with descriptions
   - "Other" free-text option
3. **Selection handler** - Track single/multi selections
4. **Result formatter** - Convert answers to string format for model
5. **Permission flow** - Prompt user before showing questions

### Example React component for web

```tsx
import { useState } from "react";

interface Option {
  label: string;
  description: string;
}

interface Question {
  question: string;
  header: string;
  options: Option[];
  multiSelect: boolean;
}

interface QuestionCardProps {
  header: string;
  question: string;
  options: Option[];
  multiSelect: boolean;
  onSelect: (value: string | string[]) => void;
}

function QuestionCard({ header, question, options, multiSelect, onSelect }: QuestionCardProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [otherText, setOtherText] = useState("");
  const [showOtherInput, setShowOtherInput] = useState(false);

  const handleOptionClick = (label: string) => {
    if (label === "Other") {
      setShowOtherInput(true);
      return;
    }

    if (multiSelect) {
      const newSelected = selected.includes(label)
        ? selected.filter(s => s !== label)
        : [...selected, label];
      setSelected(newSelected);
      onSelect(newSelected);
    } else {
      setSelected([label]);
      onSelect(label);
    }
  };

  const handleOtherSubmit = () => {
    if (otherText.trim()) {
      if (multiSelect) {
        const newSelected = [...selected, otherText];
        setSelected(newSelected);
        onSelect(newSelected);
      } else {
        setSelected([otherText]);
        onSelect(otherText);
      }
      setShowOtherInput(false);
    }
  };

  return (
    <div className="question-card">
      <span className="header-chip">{header}</span>
      <p className="question-text">{question}</p>

      <div className="options-list">
        {options.map((option) => (
          <button
            key={option.label}
            className={`option ${selected.includes(option.label) ? "selected" : ""}`}
            onClick={() => handleOptionClick(option.label)}
          >
            <span className="option-indicator">
              {multiSelect
                ? (selected.includes(option.label) ? "☑" : "☐")
                : (selected.includes(option.label) ? "◉" : "◯")
              }
            </span>
            <span className="option-label">{option.label}</span>
            <span className="option-description">{option.description}</span>
          </button>
        ))}

        <button
          className="option other-option"
          onClick={() => handleOptionClick("Other")}
        >
          <span className="option-indicator">◯</span>
          <span className="option-label">Other...</span>
        </button>
      </div>

      {showOtherInput && (
        <div className="other-input-container">
          <input
            type="text"
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            placeholder="Enter your answer..."
          />
          <button onClick={handleOtherSubmit}>Submit</button>
        </div>
      )}
    </div>
  );
}

interface AskUserQuestionProps {
  questions: Question[];
  onAnswer: (answers: Record<string, string>) => void;
}

export function AskUserQuestion({ questions, onAnswer }: AskUserQuestionProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const handleSelect = (questionText: string, value: string | string[]) => {
    const answerValue = Array.isArray(value) ? value.join(", ") : value;
    setAnswers(prev => ({ ...prev, [questionText]: answerValue }));
  };

  const handleSubmit = () => {
    onAnswer(answers);
  };

  const allQuestionsAnswered = questions.every(q => answers[q.question]);

  return (
    <div className="ask-user-container">
      {questions.map((q) => (
        <QuestionCard
          key={q.question}
          header={q.header}
          question={q.question}
          options={q.options}
          multiSelect={q.multiSelect}
          onSelect={(val) => handleSelect(q.question, val)}
        />
      ))}
      <button
        onClick={handleSubmit}
        disabled={!allQuestionsAnswered}
        className="submit-button"
      >
        Submit Answers
      </button>
    </div>
  );
}
```

---

## 9. Complete Tool Definition Template

```typescript
export const AskUserQuestionTool = {
  name: "AskUserQuestion",

  inputSchema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        minItems: 1,
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            header: { type: "string", maxLength: 12 },
            options: {
              type: "array",
              minItems: 2,
              maxItems: 4,
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  description: { type: "string" }
                },
                required: ["label", "description"]
              }
            },
            multiSelect: { type: "boolean", default: false }
          },
          required: ["question", "header", "options", "multiSelect"]
        }
      }
    },
    required: ["questions"]
  },

  async execute(input: AskUserQuestionInput, context: ExecutionContext) {
    // 1. Validate input
    const validated = inputSchema.parse(input);

    // 2. Render UI and wait for user response
    const answers = await context.renderQuestionUI(validated.questions);

    // 3. Return { questions, answers }
    return {
      data: {
        questions: validated.questions,
        answers
      }
    };
  },

  formatResult(result: AskUserQuestionOutput): string {
    return Object.entries(result.answers)
      .map(([q, a]) => `"${q}"="${a}"`)
      .join(", ");
  }
};
```

---

## 10. Integration with AI SDK / Tool Use

When integrating with the Anthropic API or AI SDK, the tool should be defined as follows:

```typescript
const tools = [
  {
    name: "AskUserQuestion",
    description: `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- Users will always be able to select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers to be selected
- If you recommend a specific option, make that the first option and add "(Recommended)"`,
    input_schema: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          description: "Questions to ask the user (1-4 questions)",
          minItems: 1,
          maxItems: 4,
          items: {
            type: "object",
            properties: {
              question: {
                type: "string",
                description: "The complete question to ask the user"
              },
              header: {
                type: "string",
                description: "Short label (max 12 chars) displayed as chip/tag"
              },
              options: {
                type: "array",
                minItems: 2,
                maxItems: 4,
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string" },
                    description: { type: "string" }
                  },
                  required: ["label", "description"]
                }
              },
              multiSelect: {
                type: "boolean",
                default: false
              }
            },
            required: ["question", "header", "options", "multiSelect"]
          }
        }
      },
      required: ["questions"]
    }
  }
];
```

---

## Summary

The key insights for recreating AskUserQuestion:

1. **Answer keying**: Use the full question text as the key in the answers record
2. **Multi-select handling**: Join multiple selections with commas
3. **"Other" option**: Always provide a free-text fallback
4. **Validation**: Enforce uniqueness of questions and option labels
5. **Result formatting**: Convert to a readable string for model consumption
6. **Permission model**: Always require user interaction before displaying questions

This implementation provides a clean, structured way to gather user input mid-conversation while maintaining full context for the model to use in subsequent reasoning.
