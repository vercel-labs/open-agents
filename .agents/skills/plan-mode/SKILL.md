---
name: plan-mode
description: Structured approach to planning before implementing non-trivial tasks. Use when the task involves new features, architectural decisions, multi-file changes, unclear requirements, or multiple valid approaches. Triggers on "/plan", "plan this", "design an approach", "let's plan first".
---

For non-trivial implementation tasks, plan before you code. Prefer planning when the task involves new features, multiple valid approaches, architectural decisions, multi-file changes, unclear requirements, or cases where user preferences matter. Skip planning for single-line fixes, obvious bugs, tasks with very specific instructions, or pure research.

## Plan File

Write your plan to a `PLAN.md` file in the project root. Build this file incrementally as you progress through the steps below -- do not wait until the end to write it all at once. If a plan file already exists, read it first and decide whether the current request is a new task (overwrite) or a continuation (revise).

## Step 1: Explore

Thoroughly explore the codebase to understand the request before designing anything.

- Read the relevant files and understand existing patterns, architecture, and conventions.
- Search for similar features and prior art in the codebase.
- **Launch parallel explorations** when the scope is uncertain or multiple areas of the codebase are involved. Give each exploration a specific, distinct search focus (e.g., one searches for existing implementations of similar features, another explores related components, a third investigates testing patterns). Use a single agent when the task is isolated to known files or the user provided specific file paths.
- Do not start implementing yet.

## Step 2: Clarify

Ask the user questions to resolve ambiguities before committing to an approach. This may cover technical implementation, UI/UX, performance, edge cases, or tradeoffs. You may ask multiple rounds, reading more code in between. Do not make large assumptions about user intent.

## Step 3: Design

Based on exploration and user input, design a concrete implementation approach:

- Provide comprehensive background context including filenames and code path traces from Step 1.
- Account for requirements and constraints discovered during exploration.
- For complex tasks, consider multiple perspectives to arrive at the best approach:
  - **New feature**: simplicity vs performance vs maintainability
  - **Bug fix**: root cause fix vs workaround vs prevention
  - **Refactoring**: minimal change vs clean architecture
- For tasks that touch multiple parts of the codebase, involve large refactors, or have many edge cases, explore different approaches in parallel before converging on a recommendation.

## Step 4: Review

Before finalizing, review your design against the original request:

1. Read the critical files your design depends on to verify your assumptions.
2. Confirm the approach aligns with the user's original intent, not just a plausible interpretation of it.
3. Ask remaining clarifying questions if anything is still ambiguous.

## Step 5: Present the Plan

Write the final plan to the plan file. The plan should be:

- **Concise enough to scan quickly, detailed enough to execute.** Include only your recommended approach, not all alternatives.
- **Specific about files.** List the paths of critical files to be modified and what changes in each.
- **Verifiable.** Include how to test the changes end-to-end.

Structure:

```
Summary: 1-2 sentences on the task and chosen approach

Context: Key findings from exploration -- existing patterns, relevant files, constraints

Approach: High-level design decision and why

Changes:
- `path/to/file.ts` - what changes and why
- `path/to/other.ts` - what changes and why

Verification:
- How to test end-to-end
- Relevant test commands
- Edge cases to check
```

Present the plan to the user and wait for approval. If the user has feedback, revise accordingly.

## Step 6: Implement and Verify

Once approved:

1. Implement the plan, tracking progress against each item.
2. After completing all items, run the verification steps from the plan to confirm all items were completed correctly.
