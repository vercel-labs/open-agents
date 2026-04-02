---
name: plan-mode
description: Holistic, system-aware planning before implementing non-trivial tasks. Use when the task involves new features, architectural decisions, multi-file changes, unclear requirements, or multiple valid approaches. Triggers on "/plan", "plan this", "design an approach", "let's plan first".
---

For non-trivial implementation tasks, plan before you code. Treat every change as a system change, not an isolated patch. Your job is not just to find a working implementation; it is to find the smallest implementation that remains coherent with the architecture, lifecycle, and future evolution of the system.

## Planning Doctrine

- **Think broadly, implement narrowly.** Analyze the surrounding system before deciding where the change belongs.
- **Every change has system implications.** Consider how the request affects data flow, ownership of state, interfaces, lifecycle, failure modes, observability, and future extension.
- **Prefer authoritative, derivable designs.** If UI state or control flow can be derived from backend events, persisted state, shared protocols, or existing abstractions, prefer that over inventing transient client-only state.
- **Choose the smallest coherent solution.** Do not default to the smallest local patch if it distorts the architecture or adds hidden follow-on complexity.
- **Expand scope only when it simplifies the system.** Widen the implementation only when a local fix would create duplicated state, fragile coupling, lifecycle mismatches, or recurring complexity.
- **Do not gold-plate.** Make bounded architectural improvements that materially improve coherence for the task at hand.

## Plan File

Write your plan to a `PLAN.md` file in the project root. Build this file incrementally as you progress through the steps below -- do not wait until the end to write it all at once. If a plan file already exists, read it first and decide whether the current request is a new task (overwrite) or a continuation (revise).

## Step 1: Explore

Thoroughly explore the codebase to understand the request before designing anything.

- Read the relevant files and understand existing patterns, architecture, and conventions.
- Trace the end-to-end flow, not just the local implementation point.
- Identify the current **source of truth**, state ownership, boundaries between subsystems, and any existing invariants.
- Identify the full lifecycle of the behavior: trigger, processing, intermediate states, completion, side effects, failure, retry, and cleanup.
- Search for similar features and prior art in the codebase.
- **Launch parallel explorations** when the scope is uncertain or multiple areas of the codebase are involved. Give each exploration a specific, distinct search focus (e.g., one searches for existing implementations of similar features, another explores related components, a third investigates testing patterns). Use a single agent when the task is isolated to known files or the user provided specific file paths.
- Do not start implementing yet.

## Step 2: Clarify

Ask the user questions to resolve ambiguities before committing to an approach. This may cover technical implementation, desired system behavior, UI/UX, performance, edge cases, ownership of state, failure handling, or tradeoffs. You may ask multiple rounds, reading more code in between. Do not make large assumptions about user intent.

## Step 3: Design

Based on exploration and user input, design a concrete implementation approach:

- Provide comprehensive background context including filenames, code path traces, and the surrounding system behavior discovered in Step 1.
- Treat the request as a system modification, not just a local diff.
- Explicitly consider both:
  - **The most direct implementation**
  - **The most system-coherent implementation**
- Choose the direct implementation only if it does **not** introduce architectural distortion, duplicated state, fragile coupling, lifecycle mismatches, or hidden follow-on complexity.
- Prefer the smallest holistic solution: think broadly about implications, then keep the implementation as narrow as possible while preserving coherence.
- For complex tasks, consider multiple perspectives to arrive at the best approach:
  - **New feature**: simplicity vs performance vs maintainability
  - **Bug fix**: root cause fix vs workaround vs prevention
  - **Refactoring**: minimal change vs clean architecture
- For tasks that touch multiple parts of the codebase, involve large refactors, or have many edge cases, explore different approaches in parallel before converging on a recommendation.

Before finalizing the design, explicitly answer these questions:

1. What part of the system is actually changing?
2. What is the source of truth before and after this change?
3. What new state, transitions, or invariants does this introduce?
4. What other components, flows, or interfaces now depend on this decision?
5. Does this create duplicated logic or state anywhere?
6. Is there a more system-coherent place to implement this?
7. What adjacent simplifications become possible if this is implemented correctly?
8. What is the smallest solution that keeps the system coherent?

## Step 4: Review

Before finalizing, review your design against the original request:

1. Read the critical files your design depends on to verify your assumptions.
2. Confirm the approach aligns with the user's original intent, not just a plausible interpretation of it.
3. Review the full lifecycle and make sure the design accounts for loading, in-progress, completion, failure, retry, resume, and cleanup where applicable.
4. Confirm any widened scope is bounded and justified by simpler system behavior, not by speculative improvement.
5. Ask remaining clarifying questions if anything is still ambiguous.

## Step 5: Present the Plan

Write the final plan to the plan file. The plan should be:

- **Concise enough to scan quickly, detailed enough to execute.** Include only your recommended approach, not all alternatives.
- **Specific about files.** List the paths of critical files to be modified and what changes in each.
- **Explicit about system impact.** Make clear how the change affects state ownership, data flow, interfaces, or lifecycle.
- **Verifiable.** Include how to test the changes end-to-end.

Structure:

```
Summary: 1-2 sentences on the task and chosen approach

Context: Key findings from exploration -- existing patterns, relevant files, constraints

System Impact: How the change affects source of truth, data flow, lifecycle, and dependent parts of the system

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
