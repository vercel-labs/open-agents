# Deep Agents: A First Principles Guide

> A conceptual guide to building AI agents that can handle complex, multi-step tasks. Learn the patterns first, then implement them with any provider.

## Table of Contents

1. [The Fundamental Problem](#the-fundamental-problem)
2. [The Four Core Patterns](#the-four-core-patterns)
   - [Pattern 1: Planning and Task Decomposition](#pattern-1-planning-and-task-decomposition)
   - [Pattern 2: Context Management](#pattern-2-context-management)
   - [Pattern 3: Subagent Spawning](#pattern-3-subagent-spawning)
   - [Pattern 4: Long-term Memory](#pattern-4-long-term-memory)
3. [How the Patterns Compose](#how-the-patterns-compose)
4. [Complete Example: Research Agent](#complete-example-research-agent)
5. [Reference Implementation](#reference-implementation)

---

## The Fundamental Problem

### Simple Agents Work for Simple Tasks

A basic AI agent follows this loop:

```
1. Receive user request
2. Call LLM to decide what to do
3. Execute tool (if needed)
4. Repeat until done
```

This works for simple tasks:

- "What's the weather in Paris?" → Call weather API → Done
- "Set a reminder for 3pm" → Call calendar API → Done

### Complex Tasks Expose Limitations

Try this: **"Research the history of quantum computing, compare three major approaches, and write a comprehensive report with citations."**

A simple loop fails because:

1. **No Planning** - The agent doesn't break down the task into steps
2. **Context Overflow** - 50+ web searches fill the conversation history
3. **No Organization** - Research notes are scattered across messages
4. **Linear Execution** - Can't parallelize independent research streams
5. **Lost Focus** - The main thread gets polluted with tangential details
6. **No Memory** - Can't remember what it learned in previous conversations

The agent becomes "shallow" - it can't sustain focus, plan ahead, manage information, or build on prior knowledge.

---

## The Four Core Patterns

Production systems like Claude Code, Deep Research, and Manus successfully handle complex tasks. They share **four core patterns**:

| Pattern            | Problem Addressed                        | Scope                  |
| ------------------ | ---------------------------------------- | ---------------------- |
| Planning           | Managing multi-step objectives           | Within a task          |
| Context Management | Keeping context window from overflowing  | Within a thread        |
| Subagent Spawning  | Isolating subtask complexity             | Across concurrent work |
| Long-term Memory   | Retaining knowledge across conversations | Across threads         |

Each pattern addresses a different dimension of complexity. Together, they enable agents to handle tasks that would overwhelm a simple loop.

---

## Pattern 1: Planning and Task Decomposition

### The Problem

Agents lose track of multi-step objectives. They start researching one topic, get distracted by a tangent, and forget what they were supposed to do. Without explicit planning, complex tasks become a random walk.

### The Solution

Give the agent a tool to write down and track its plan. This forces explicit decomposition and provides a visible progress tracker.

### Conceptual Implementation

Create a tool that lets the agent maintain a todo list:

```
Tool: write_todos
Input: List of { id, content, status }
Effect: Stores the todo list in conversation state
```

The agent can then:

1. Break down complex tasks into steps at the start
2. Mark items as in-progress or completed
3. Update the plan as it learns more
4. Review what's left to do

### Example Flow

```
User: "Research quantum computing and write a report"

Agent calls write_todos:
[
  { id: "1", content: "Research trapped ion approach", status: "pending" },
  { id: "2", content: "Research superconducting qubits", status: "pending" },
  { id: "3", content: "Compare approaches", status: "pending" },
  { id: "4", content: "Write comprehensive report", status: "pending" }
]

Agent works on task 1, then updates:
[
  { id: "1", content: "Research trapped ion approach", status: "completed" },
  { id: "2", content: "Research superconducting qubits", status: "in-progress" },
  ...
]
```

### Why It Works

- **Forces decomposition**: The agent must think about steps before acting
- **Prevents rabbit holes**: The plan provides a reference point
- **Enables recovery**: If interrupted, the agent can see what's left
- **Visible progress**: Users (and the agent) can track completion

### Key Design Decisions

1. **Store todos in conversation state** - They persist across agent turns
2. **Simple schema** - id, content, status is enough
3. **Agent controls updates** - The agent decides when to mark things complete
4. **No enforcement** - The plan is guidance, not a constraint

### Implementation Notes

The tool needs to:

- Accept a list of todo items
- Store them in a way that persists across turns (conversation state)
- Return them in the context so the agent sees its current plan

With the AI SDK, you might store todos in a state object that gets passed through each step. With raw API calls, you might include the current todo list in the system prompt or as a special message.

---

## Pattern 2: Context Management

### The Problem

Tool results can be huge. A single web search might return 100KB of content. After 20 searches, you've consumed most of your context window with raw data, leaving no room for reasoning.

Even worse, most of that content is noise. The agent only needs a few relevant facts, but they're buried in megabytes of search results.

### The Solution

Give the agent a "scratchpad" where it can store and retrieve information. Large results get saved to the scratchpad instead of staying in chat history. The agent can then search and read only what it needs.

### Conceptual Implementation

Provide filesystem-like tools:

```
Tool: write_file
Input: { path, content }
Effect: Stores content at the given path

Tool: read_file
Input: { path, offset?, limit? }
Effect: Returns content (with pagination)

Tool: grep
Input: { pattern, path? }
Effect: Searches content without loading everything

Tool: ls
Input: { path }
Effect: Lists what's stored
```

Plus **automatic eviction**: When any tool returns a result larger than a threshold (e.g., 80KB), automatically save it to a file and replace the result with a pointer:

```
Before: "Here are 10,000 search results: [massive blob]..."
After:  "Tool result saved to /large_results/search_001. Use read_file or grep to access."
```

### Example Flow

```
Agent calls web_search("quantum computing history")
→ Returns 150KB of content
→ Automatically evicted to /large_results/search_001
→ Agent sees: "Results saved to /large_results/search_001"

Agent calls grep({ pattern: "trapped ion", path: "/large_results/search_001" })
→ Returns only matching lines (2KB)

Agent calls write_file({ path: "/notes/trapped_ion.md", content: "Key findings..." })
→ Saves synthesized notes for later
```

### Why It Works

- **Context efficiency**: Only relevant content enters the context
- **Organization**: Structured storage vs. scattered messages
- **Search**: Agent can grep through stored content
- **Scalability**: Can handle arbitrarily large research tasks

### Key Design Decisions

1. **Filesystem metaphor** - Familiar abstraction that developers understand
2. **Automatic eviction** - Agent doesn't need to decide what to offload
3. **Pagination on read** - Never load more than needed
4. **Search tools** - grep/glob let agent find content without loading it

### Implementation Notes

The "filesystem" doesn't need to be a real filesystem. It can be:

- An in-memory object (simplest)
- A key-value store
- Actual files on disk

The key insight is that **conversation history is expensive context**, while **stored files are cheap until accessed**. By moving large content out of the message stream, you keep the agent's reasoning space clear.

With any provider, you can implement this by:

1. Intercepting tool results before they enter the message history
2. If result exceeds threshold, store it and replace with pointer
3. Providing read/write/search tools that access the storage

---

## Pattern 3: Subagent Spawning

### The Problem

Complex subtasks pollute the main agent's context. If the main task is "compare quantum computing approaches," and you research each approach in the main thread:

- 100+ messages about trapped ion physics
- 100+ messages about superconducting qubits
- Main agent loses focus on comparison task
- Token limit approached

Even with context management (Pattern 2), the main thread accumulates tool calls, intermediate reasoning, and tangential details.

### The Solution

Spawn **ephemeral subagents** for complex, independent subtasks. Each subagent:

1. Gets a fresh context (no parent messages)
2. Works autonomously with its own tools
3. Returns only a summary to the parent
4. Has its context discarded after completion

### Conceptual Implementation

Provide a `task` tool:

```
Tool: task
Input: { description, subagent_type? }
Effect:
  1. Spawn new agent with fresh context
  2. Run it to completion
  3. Return only its final message
```

The subagent lifecycle:

```
SPAWN  → Subagent gets clean context (just the task description)
RUN    → Subagent works autonomously (many tool calls, large context)
RETURN → Parent receives only the final summary
DISCARD → Subagent context is freed
```

### Example Flow

```
Main agent's task: "Compare quantum computing approaches"

Main agent calls task({
  description: "Research trapped ion quantum computing.
                Return 800-word summary with key findings and sources."
})

Subagent (fresh context):
  - Does 15 web searches
  - Accumulates 500KB of content in its context
  - Synthesizes findings
  - Returns: "## Trapped Ion QC\n\nTrapped ion quantum computing uses..."

Main agent receives ONLY the 800-word summary
Subagent's 500KB context is discarded
```

### Parallel Execution

Multiple subagents can run concurrently:

```
Main agent calls (in parallel):
  task({ description: "Research trapped ion QC..." })
  task({ description: "Research superconducting qubits..." })
  task({ description: "Research topological qubits..." })

→ All three run concurrently
→ Main agent receives three summaries
→ Main agent synthesizes the comparison
```

### Why It Works

- **Context isolation**: Main agent's history stays clean
- **Parallelization**: Independent tasks run concurrently
- **Specialization**: Subagents can have different tools/prompts
- **Focus**: Main agent orchestrates, subagents execute

### Key Design Decisions

1. **Fresh context** - Subagents don't inherit parent messages
2. **Shared scratchpad** - Subagents CAN access the same filesystem (Pattern 2)
3. **Summary only** - Parent sees only the final message
4. **Stateless** - Each subagent invocation is independent

### When NOT to Use Subagents

- When you need to see intermediate reasoning
- When the task is trivial (a few tool calls)
- When tasks are interdependent (need to share state mid-execution)

### Implementation Notes

To implement subagent spawning:

1. Create a `task` tool that accepts a description
2. When called, instantiate a new agent with:
   - Fresh message history (just the task as a human message)
   - Access to the same scratchpad (for file sharing)
   - Its own todo list (not inherited)
3. Run the subagent to completion
4. Extract the final assistant message as the tool result
5. Return that result to the parent agent

The key challenge is **state isolation**. The subagent should:

- NOT see parent's messages or todos
- YES access the shared scratchpad (so it can read/write files)
- Return state updates (files it wrote) to the parent

---

## Pattern 4: Long-term Memory

### The Problem

Knowledge is lost when conversations end. Every new conversation starts from scratch. The agent can't remember:

- User preferences
- Past research
- Accumulated knowledge
- Previous decisions

### The Solution

Persist selected information to a store that survives across conversations. Use the same filesystem tools (Pattern 2), but route certain paths to persistent storage.

### Conceptual Implementation

Introduce different storage backends with different lifetimes:

| Storage Type        | Lifetime                           | Use Case                         |
| ------------------- | ---------------------------------- | -------------------------------- |
| Ephemeral (default) | Current conversation only          | Scratch work, intermediate notes |
| Persistent          | Forever (across all conversations) | Memories, preferences, knowledge |

Route by path:

```
/scratch/*     → Ephemeral (gone when conversation ends)
/memories/*    → Persistent (survives across conversations)
/research/*    → Ephemeral (default)
```

### Example Flow

```
Conversation 1:
  Agent writes: /memories/user_preferences.json → { "style": "detailed" }
  Agent writes: /scratch/temp_notes.txt → "Working notes..."
  Conversation ends

Conversation 2 (new thread):
  Agent reads: /memories/user_preferences.json → { "style": "detailed" } ✓
  Agent reads: /scratch/temp_notes.txt → "File not found" ✗
```

### Why It Works

- **Explicit persistence**: Developer/agent decides what to persist
- **Same interface**: Use familiar read/write/grep tools
- **Path-based routing**: Natural organization by lifetime
- **Cross-conversation knowledge**: Build up expertise over time

### Key Design Decisions

1. **Opt-in persistence** - Ephemeral by default, persist explicitly
2. **Path routing** - Use path prefixes to determine storage
3. **Same tools** - No new tools to learn, just different paths
4. **Scoping** - Can be per-user, per-assistant, or global

### Implementation Notes

Long-term memory requires a persistent store:

- A database (Postgres, Redis, etc.)
- A key-value store
- Cloud storage (S3, etc.)

The agent uses the same `write_file`/`read_file` tools, but a routing layer directs operations:

```
write_file("/memories/notes.txt", content)
  → Router sees "/memories/" prefix
  → Routes to persistent store
  → Content survives across conversations

write_file("/scratch/temp.txt", content)
  → Router sees no special prefix
  → Routes to ephemeral storage (default)
  → Content exists only in current conversation
```

---

## How the Patterns Compose

The four patterns work together to handle complex tasks:

```
┌─────────────────────────────────────────────────────────────┐
│                      Main Agent                              │
│                                                              │
│  ┌─────────────┐  ┌──────────────────┐  ┌────────────────┐ │
│  │   Planning  │  │ Context Mgmt     │  │  Long-term     │ │
│  │  (todos)    │  │ (scratchpad)     │  │  Memory        │ │
│  └─────────────┘  └──────────────────┘  └────────────────┘ │
│                                                              │
│         │                   │                    │           │
│         ▼                   ▼                    ▼           │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                    task tool                             ││
│  │                  (spawns subagents)                      ││
│  └─────────────────────────────────────────────────────────┘│
│                            │                                 │
└────────────────────────────┼─────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
   ┌──────────┐       ┌──────────┐       ┌──────────┐
   │ Subagent │       │ Subagent │       │ Subagent │
   │   (own   │       │   (own   │       │   (own   │
   │  todos,  │       │  todos,  │       │  todos,  │
   │ context) │       │ context) │       │ context) │
   └────┬─────┘       └────┬─────┘       └────┬─────┘
        │                  │                  │
        └──────────────────┴──────────────────┘
                           │
                   Shared Scratchpad
                   (files, memories)
```

**How they interact:**

1. **Main agent plans** using todos
2. **Main agent delegates** complex subtasks via `task` tool
3. **Subagents work in isolation** with their own todos and context
4. **All agents share the scratchpad** for file storage
5. **Long-term memories** persist beyond any single conversation

---

## Complete Example: Research Agent

Let's trace a complex task through all four patterns.

### The Request

**User**: "Research quantum computing approaches and write a comprehensive comparison report."

### Step 1: Planning

```
Agent calls write_todos([
  { id: "1", content: "Research trapped ion QC", status: "pending" },
  { id: "2", content: "Research superconducting qubits", status: "pending" },
  { id: "3", content: "Research topological qubits", status: "pending" },
  { id: "4", content: "Write comparison report", status: "pending" },
  { id: "5", content: "Review and refine", status: "pending" }
])
```

### Step 2: Parallel Research (Subagents)

```
Agent calls (in parallel):

task({
  description: "Research trapped ion quantum computing.
               Cover: principles, key companies, pros/cons, current state.
               Return 800-word summary with sources."
})

task({
  description: "Research superconducting qubit quantum computing.
               Cover: principles, key companies, pros/cons, current state.
               Return 800-word summary with sources."
})

task({
  description: "Research topological qubit quantum computing.
               Cover: principles, key companies, pros/cons, current state.
               Return 800-word summary with sources."
})
```

Each subagent (isolated context):

- Does 10-15 web searches
- Accumulates hundreds of KB in its context
- Writes notes to /research/
- Synthesizes findings
- Returns only the summary

Main agent receives three ~800-word summaries instead of 30+ search results.

### Step 3: Context Management

```
Agent saves the research:
  write_file("/research/trapped_ion.md", [subagent 1 summary])
  write_file("/research/superconducting.md", [subagent 2 summary])
  write_file("/research/topological.md", [subagent 3 summary])

Agent updates todos:
  write_todos([
    { id: "1", ..., status: "completed" },
    { id: "2", ..., status: "completed" },
    { id: "3", ..., status: "completed" },
    { id: "4", ..., status: "in-progress" },
    { id: "5", ..., status: "pending" }
  ])
```

### Step 4: Report Writing

```
Agent reads research back:
  read_file("/research/trapped_ion.md")
  read_file("/research/superconducting.md")
  read_file("/research/topological.md")

Agent writes report:
  write_file("/final_report.md", "# Quantum Computing: A Comparison\n\n...")
```

### Step 5: Long-term Memory (Optional)

```
Agent saves key findings for future reference:
  write_file("/memories/quantum_computing_2025.md", [summary of key facts])

Future conversations can access this knowledge:
  read_file("/memories/quantum_computing_2025.md")
```

### Final State

The main agent's message history is clean (~15 messages). The heavy research (30+ searches, hundreds of KB) was contained in subagents. Key findings persist in memory for future use.

---

## Reference Implementation

This repository provides a working implementation of these patterns using LangChain/LangGraph. Here's how each pattern maps to the codebase:

### Pattern 1: Planning → `todoListMiddleware`

LangChain provides `todoListMiddleware` which:

- Adds a `write_todos` tool to the agent
- Stores todos in LangGraph state under a `todos` key
- Persists with the conversation (if a checkpointer is configured)

```typescript
import { todoListMiddleware } from "langchain";

const middleware = [todoListMiddleware()];
```

### Pattern 2: Context Management → `createFilesystemMiddleware`

The `createFilesystemMiddleware` function:

- Adds `ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep` tools
- Implements automatic eviction for large tool results
- Works with pluggable backends

```typescript
import { createFilesystemMiddleware } from "./middleware/fs.js";
import { StateBackend } from "./backends/state.js";

const middleware = [
  createFilesystemMiddleware({
    backend: (config) => new StateBackend(config),
    toolTokenLimitBeforeEvict: 20000, // ~80KB
  }),
];
```

### Pattern 3: Subagent Spawning → `createSubAgentMiddleware`

The `createSubAgentMiddleware` function:

- Creates a `task` tool for spawning subagents
- Filters state to exclude `messages` and `todos`
- Shares `files` state (so subagents access the same scratchpad)
- Returns only the subagent's final message

```typescript
import { createSubAgentMiddleware } from "./middleware/subagents.js";

const middleware = [
  createSubAgentMiddleware({
    defaultModel: model,
    defaultTools: tools,
    subagents: [researchSubAgent, critiqueSubAgent],
    generalPurposeAgent: true,
  }),
];
```

### Pattern 4: Long-term Memory → `StoreBackend` / `CompositeBackend`

Different backends implement different storage lifetimes:

| Backend             | Lifetime       | Where                 |
| ------------------- | -------------- | --------------------- |
| `StateBackend`      | Current thread | LangGraph state       |
| `StoreBackend`      | Forever        | LangGraph BaseStore   |
| `FilesystemBackend` | Until deleted  | Disk                  |
| `CompositeBackend`  | Hybrid         | Routes by path prefix |

```typescript
import {
  CompositeBackend,
  StateBackend,
  StoreBackend,
} from "./backends/index.js";

const backend = (config) =>
  new CompositeBackend(
    new StateBackend(config), // Default: ephemeral
    {
      "/memories/": new StoreBackend(config), // Persistent
    },
  );
```

### Putting It Together: `createDeepAgent`

The `createDeepAgent` function assembles all patterns:

```typescript
import { createDeepAgent } from "./agent.js";

const agent = createDeepAgent({
  model: "claude-sonnet-4-5-20250929",
  tools: [webSearch, calculator],
  systemPrompt: "You are a research assistant...",
  subagents: [researchSubAgent],
  backend: (config) =>
    new CompositeBackend(new StateBackend(config), {
      "/memories/": new StoreBackend(config),
    }),
  store: myPersistentStore,
  checkpointer: myCheckpointer,
});

// Use like any LangGraph agent
const result = await agent.invoke({
  messages: [{ role: "user", content: "Research quantum computing..." }],
});
```

### Backend Protocol

All backends implement a common interface, so the agent doesn't care where data lives:

```typescript
interface BackendProtocol {
  lsInfo(path: string): FileInfo[];
  read(filePath: string, offset?: number, limit?: number): string;
  write(filePath: string, content: string): WriteResult;
  edit(filePath: string, oldString: string, newString: string): EditResult;
  globInfo(pattern: string, path?: string): FileInfo[];
  grepRaw(pattern: string, path?: string, glob?: string): GrepMatch[];
}
```

### Codebase Structure

```
src/
├── agent.ts              # createDeepAgent - assembles all patterns
├── middleware/
│   ├── fs.ts             # Pattern 2: Filesystem tools + eviction
│   └── subagents.ts      # Pattern 3: Task tool + subagent spawning
└── backends/
    ├── protocol.ts       # BackendProtocol interface
    ├── state.ts          # StateBackend (ephemeral, in LangGraph state)
    ├── store.ts          # StoreBackend (persistent, in BaseStore)
    ├── filesystem.ts     # FilesystemBackend (real disk files)
    └── composite.ts      # CompositeBackend (path-based routing)
```

---

## Summary

Deep agents solve complex tasks through four composable patterns:

1. **Planning** - Explicit task decomposition with a todo list
2. **Context Management** - Scratchpad storage with automatic eviction
3. **Subagent Spawning** - Isolated workers for complex subtasks
4. **Long-term Memory** - Persistent storage across conversations

These patterns are **provider-agnostic**. You can implement them with:

- OpenAI's API directly
- Anthropic's API directly
- The AI SDK with any provider
- LangChain/LangGraph (this reference implementation)

The key insight: **Complex tasks require more than tool calling in a loop.** They require planning, memory management, delegation, and persistence. These four patterns provide the primitives to build agents that can truly handle complexity.

---

## Tool Design Guidelines

Effective tool design is critical for agent performance. Poorly designed tools confuse the model, waste tokens, and lead to errors. The following guidelines are derived from production systems like Claude Code.

### Number of Tools

**Keep the tool count manageable.** Each tool adds cognitive overhead for the model.

| Agent Type            | Recommended Tools | Rationale                                  |
| --------------------- | ----------------- | ------------------------------------------ |
| Focused subagent      | 3-8 tools         | Single responsibility, minimal confusion   |
| General-purpose agent | 10-20 tools       | Broad capability, still comprehensible     |
| Main orchestrator     | 15-25 tools       | Includes delegation tools + core utilities |

**Guidelines:**

- Start with fewer tools and add as needed
- Prefer specialized tools over general-purpose ones (e.g., `Read` tool instead of `cat` via Bash)
- Remove tools the agent never uses
- Subagents should have only the tools they need for their specific task
- Restrict certain subagents to read-only tools when appropriate

### Tool Naming

Tool names should be **descriptive** and **concise**. Both naming conventions work in practice:

**PascalCase (used by Claude Code):**

```
Read
Write
Edit
Glob
Grep
Bash
Task
WebSearch
WebFetch
TodoWrite
```

**snake_case (alternative convention):**

```
read_file
write_file
edit_file
web_search
write_todos
```

**Naming principles:**

| Principle        | Rationale                                  |
| ---------------- | ------------------------------------------ |
| Be specific      | `Grep` not `search`, `Read` not `get`      |
| Match the action | `Write` for creating, `Edit` for modifying |
| Keep it short    | Single words when possible                 |
| Be consistent    | Pick one convention and stick with it      |

### Tool Descriptions

The description is the model's primary guide for when and how to use a tool. Production systems use **comprehensive descriptions** (100-500 words) that eliminate ambiguity.

**Structure (based on Claude Code):**

```
1. Primary function (one sentence)
2. Usage section with bullet points
3. When to use / when NOT to use
4. Parameter explanations with examples
5. Important notes and warnings (use IMPORTANT: prefix)
```

**Example: Production-quality description**

```typescript
{
  name: "Read",
  description: `Reads a file from the filesystem.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, reads up to 2000 lines starting from the beginning
- You can optionally specify a line offset and limit for long files
- Results are returned with line numbers starting at 1
- Can read images, PDFs, and Jupyter notebooks
- Can only read files, not directories. Use ls via Bash for directories.

IMPORTANT: If a user asks about or wants you to modify a file, read it first.
Understand existing code before suggesting modifications.

You can call multiple Read tools in parallel to speculatively read
multiple potentially useful files at once.`
}
```

**Key patterns from production:**

1. **Explicit anti-patterns**: Tell the agent what NOT to do
2. **IMPORTANT callouts**: Use `IMPORTANT:` prefix for critical behavior
3. **Parallel execution hints**: Tell agents when they can batch calls
4. **Cross-tool guidance**: Explain when to use this tool vs. alternatives

**Example: Anti-pattern guidance**

```typescript
{
  name: "Bash",
  description: `Executes bash commands in a persistent shell session.

IMPORTANT: This tool is for terminal operations like git, npm, docker.
DO NOT use it for file operations - use specialized tools instead:
- Read for reading files (NOT cat/head/tail)
- Edit for editing files (NOT sed/awk)
- Write for creating files (NOT echo/heredoc)
- Grep for searching (NOT grep or rg commands)

Usage notes:
- Commands timeout after 2 minutes by default
- Output over 30000 characters will be truncated
- Always quote file paths containing spaces`
}
```

### Tool Parameters

Define parameters with **clear names**, **descriptions**, and **appropriate types**.

**Parameter schema best practices:**

```typescript
{
  name: "Read",
  parameters: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "The absolute path to the file to read"
      },
      offset: {
        type: "number",
        description: "The line number to start reading from. Only provide if the file is too large to read at once."
      },
      limit: {
        type: "number",
        description: "The number of lines to read. Only provide if the file is too large to read at once."
      }
    },
    required: ["file_path"]
  }
}
```

**Guidelines:**

- Use descriptive parameter names (`file_path` not `p`)
- Include guidance on when to use optional parameters
- Mark required vs. optional parameters explicitly
- Provide sensible defaults for optional parameters
- Use enums for constrained choices

**Example with enum:**

```typescript
{
  name: "TodoWrite",
  parameters: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "The task description"
            },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "completed"],
              description: "Current status. Only ONE task should be in_progress at a time."
            }
          },
          required: ["content", "status"]
        }
      }
    },
    required: ["todos"]
  }
}
```

### Tool Selection Guidance

Production systems include explicit guidance on tool selection in descriptions. Use strong language to prevent misuse:

| Pattern                | Example                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| **ALWAYS use X for Y** | "ALWAYS use Grep for search tasks"                               |
| **NEVER use X for Y**  | "NEVER invoke `grep` as a Bash command"                          |
| **Prefer X over Y**    | "Prefer Read tool over cat command"                              |
| **Use X when Y**       | "Use Task tool when search may require multiple rounds"          |
| **When NOT to use**    | "When NOT to use: single file reads, specific class definitions" |

### Core Tool Set

For a deep agent implementing all four patterns, here's a recommended tool set:

**Planning tools:**

| Tool        | Purpose                     |
| ----------- | --------------------------- |
| `TodoWrite` | Create/update the task list |

**Context management tools:**

| Tool    | Purpose                                      |
| ------- | -------------------------------------------- |
| `Write` | Save content to scratchpad                   |
| `Read`  | Read content (with pagination)               |
| `Edit`  | Modify existing content (exact string match) |
| `Glob`  | Find files by pattern                        |
| `Grep`  | Search content by regex                      |

**Delegation tools:**

| Tool   | Purpose                               |
| ------ | ------------------------------------- |
| `Task` | Spawn a subagent for complex subtasks |

**General execution:**

| Tool   | Purpose                                              |
| ------ | ---------------------------------------------------- |
| `Bash` | Terminal operations (git, npm, docker) - NOT for I/O |

**Domain tools (varies by use case):**

| Tool        | Purpose                                       |
| ----------- | --------------------------------------------- |
| `WebSearch` | Search the internet for current information   |
| `WebFetch`  | Fetch and extract content from a specific URL |

---

## System Prompt Design

The system prompt shapes agent behavior more than any other factor. A well-designed prompt establishes identity, capabilities, and behavioral constraints. The following guidelines are derived from production systems like Claude Code.

### Structure

Production system prompts are organized into distinct, well-labeled sections:

```
1. Main identity (who the agent is)
2. Tone and style guidelines
3. Professional behavior standards
4. Task management instructions
5. Tool usage policies
6. Safety and security constraints
7. Output format requirements
8. Environment context (injected dynamically)
```

### Example System Prompt

```
You are a research assistant that helps users investigate topics and produce comprehensive reports.

## Tone and Style

- Keep responses concise. Your output will be displayed in a terminal.
- Use markdown formatting for structure.
- Do not use emojis unless the user explicitly requests them.
- Output text to communicate; never use tools (like Bash echo) to talk to the user.

## Task Management

You have access to TodoWrite to track your tasks. Use it VERY frequently to:
- Plan multi-step tasks before starting
- Track progress as you work
- Mark todos as completed immediately when done (don't batch)

IMPORTANT: Only ONE todo should be in_progress at a time.

## Doing Tasks

For complex tasks, follow these steps:

1. **Plan first**: Use TodoWrite to break down the task into steps.

2. **Read before editing**: NEVER propose changes to code you haven't read.
   If a user asks about or wants you to modify a file, read it first.

3. **Delegate when appropriate**: For research requiring 5+ searches,
   spawn a subagent using Task. Request a summary, not raw findings.

4. **Organize as you go**: Save findings to files:
   - /research/[topic].md for research notes
   - /drafts/[name].md for draft content

5. **Complete fully**: Do not stop mid-task or claim a task is too large.
   Continue working until done or the user stops you.

## Tool Usage Policy

- ALWAYS use Read for file reading (NOT cat/head/tail via Bash)
- ALWAYS use Grep for searching (NOT grep/rg via Bash)
- ALWAYS use Edit for file modifications (NOT sed/awk via Bash)
- When exploring the codebase broadly, use Task with subagent_type=Explore
- You can call multiple tools in parallel when they're independent

## Constraints

- Do not fabricate information or make up citations
- Do not create files unless absolutely necessary
- Do not commit changes unless explicitly asked
- If uncertain, investigate first rather than guessing
- Prioritize technical accuracy over validation

## Output Format

- Use markdown formatting
- Include file_path:line_number when referencing code
- Keep responses concise unless detail is requested
- List sources at the end when presenting research
```

### Key Elements

**1. Identity statement**

One sentence establishing what the agent is:

```
You are a research assistant that helps users investigate topics.
```

Avoid vague identities ("You are a helpful AI"). Be specific about the agent's domain.

**2. Tone and style**

Explicit guidance on communication style:

```
- Keep responses concise
- Use markdown formatting
- Do not use emojis unless requested
- Never use tools to communicate (only to complete tasks)
```

**3. Task management (Planning pattern)**

Instructions for using the todo system:

```
Use TodoWrite VERY frequently to:
- Plan multi-step tasks before starting
- Track progress as you work
- Mark todos completed immediately (don't batch)

IMPORTANT: Only ONE todo should be in_progress at a time.
```

**4. Working method**

Step-by-step guidance on how to approach tasks:

```
1. Plan first - break down complex tasks
2. Read before editing - understand existing code
3. Delegate when appropriate - use subagents for heavy lifting
4. Organize as you go - save to files
5. Complete fully - don't stop mid-task
```

**5. Tool usage policy**

Explicit tool selection rules with strong language:

```
- ALWAYS use X for Y (NOT Z)
- NEVER use X for Y
- When doing X, use Y tool instead
```

This prevents the agent from using suboptimal approaches (e.g., running `cat` via Bash instead of using the Read tool).

**6. Constraints with NEVER/ALWAYS**

Production systems use strong language for critical constraints:

```
- NEVER propose changes to code you haven't read
- NEVER create files unless absolutely necessary
- ALWAYS read existing files before editing
- Do not stop mid-task or claim context limits
```

**7. Output format**

How to structure responses:

```
- Use markdown formatting
- Include file_path:line_number when referencing code
- Keep responses concise unless detail is requested
```

### Pattern Triggers

Tell the agent when to use each pattern:

| Pattern      | Trigger instruction                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| Planning     | "Use TodoWrite VERY frequently. Plan multi-step tasks before starting."                                |
| Context mgmt | "Save findings to files. Use Grep to search rather than loading everything."                           |
| Subagents    | "For research requiring 5+ searches, spawn a subagent. When exploring broadly, use Task with Explore." |
| Memory       | "Save important learnings to /memories/ for future reference."                                         |

### Subagent Prompts

Subagent prompts should be **focused** and include explicit constraints:

```
Research [specific topic].

This is a READ-ONLY task. You CANNOT edit, write, or create files.

Cover:
- [Aspect 1]
- [Aspect 2]
- [Aspect 3]

Return an 800-word summary with:
- Key findings
- Notable companies/people
- Current state of the field
- Sources used

IMPORTANT: Return only the summary. Do not include raw search results.
```

**Key differences from main agent prompts:**

- No planning instructions (subagent has single task)
- Explicit capability constraints (read-only, no file creation)
- Specific output requirements (word count, format)
- Clear deliverable ("Return a summary")
- IMPORTANT callouts for critical behavior

### Subagent Type Definitions

Production systems define subagent types with explicit tool restrictions:

```typescript
const exploreAgent = {
  name: "Explore",
  description: `Fast agent for exploring codebases. READ-ONLY.

STRICTLY PROHIBITED from:
- Creating new files (no Write, touch, or file creation)
- Modifying existing files (no Edit operations)
- Running commands that change system state

Your role is EXCLUSIVELY to search and analyze existing code.

Tools: Glob, Grep, Read, Bash (read-only operations only)`,
  tools: [Glob, Grep, Read, Bash], // Bash restricted in description
};

const generalPurposeAgent = {
  name: "general-purpose",
  description: `General-purpose agent for complex, multi-step tasks.
Use when searching for code and not confident you'll find it quickly.`,
  tools: allTools,
};
```

### Dynamic Context Injection

Production systems inject runtime context into the prompt:

```
Here is useful information about the environment:
<env>
Working directory: /Users/name/project
Is directory a git repo: Yes
Platform: darwin
Today's date: 2025-01-15
</env>
```

This helps the agent make contextually appropriate decisions.

### Prompt Length

| Agent Type           | Recommended Length | Rationale                                  |
| -------------------- | ------------------ | ------------------------------------------ |
| Focused subagent     | 100-400 words      | Single task, explicit constraints          |
| Main agent           | 1000-2500 words    | Multiple patterns, detailed tool policies  |
| Complex orchestrator | 2000-4000 words    | Many tools, safety constraints, edge cases |

Production systems like Claude Code use longer prompts (2000+ words) to ensure reliable behavior. The overhead is worth it for reduced errors and better tool selection.

### Testing Prompts

Iterate on prompts by testing against scenarios:

1. **Happy path**: Does the agent handle the expected case?
2. **Edge cases**: What happens with ambiguous requests?
3. **Tool selection**: Does it use specialized tools (Read) instead of general ones (Bash cat)?
4. **Constraint adherence**: Does it respect NEVER/ALWAYS rules?
5. **Failure modes**: Does the agent recover from tool errors?
6. **Pattern usage**: Does the agent use patterns appropriately?

Track which prompt changes improve behavior and which cause regressions.

---

_Last Updated: December 2025_
