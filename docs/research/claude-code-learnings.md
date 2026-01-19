# Learnings from Claude Code Internals

Analysis of Claude Code v2.0.62 system prompt and architecture.

## 1. Tool Architecture

### Specialized Tools Over Generic Bash

Claude Code uses dedicated tools for specific operations rather than relying on bash:

| Operation      | Tool    | Why Not Bash                                  |
| -------------- | ------- | --------------------------------------------- |
| Read files     | `Read`  | Better UX, handles images/PDFs/notebooks      |
| Write files    | `Write` | Prevents overwrite without read-first         |
| Edit files     | `Edit`  | Exact string replacement, safer than sed/awk  |
| Search content | `Grep`  | Optimized permissions, ripgrep-based          |
| Find files     | `Glob`  | Pattern matching, sorted by modification time |
| Terminal ops   | `Bash`  | Reserved for git, npm, docker, etc.           |

**Key insight**: Bash is explicitly restricted from file operations. This separation improves safety and user experience.

### Edit Tool Design

- Requires reading file first before editing
- Uses exact string matching (not line numbers)
- `old_string` must be unique in file or edit fails
- `replace_all` flag for bulk replacements
- Forces preservation of exact indentation

## 2. Subagent/Task System

Claude Code spawns specialized agents for different task types:

### Agent Types

1. **Explore** - READ-ONLY codebase exploration
   - Fast file pattern matching
   - Code search with regex
   - Strictly prohibited from any writes

2. **Plan** - Software architect agent
   - Designs implementation plans
   - Identifies critical files
   - Considers architectural trade-offs
   - Also READ-ONLY

3. **claude-code-guide** - Documentation specialist
   - Answers questions about Claude Code itself
   - Has WebFetch/WebSearch access

4. **general-purpose** - Full capability agent
   - All tools available
   - For complex multi-step tasks

### Agent Execution Model

- Agents run as subprocesses
- Can run in background (`run_in_background: true`)
- Can be resumed with `resume` parameter + agent ID
- Results not visible to user - parent must summarize
- Multiple agents can run in parallel

**Key insight**: The Explore agent being strictly read-only is a safety feature. Separation of exploration from modification prevents accidental changes during research.

## 3. Planning Mode

Two-phase approach for non-trivial tasks:

### EnterPlanMode

Triggers when:

- New feature implementation
- Multiple valid approaches exist
- Code modifications affect existing behavior
- Architectural decisions needed
- Multi-file changes (>2-3 files)
- Unclear requirements

### ExitPlanMode

- Requires user approval before coding
- Can launch a "swarm" of teammates
- `teammateCount` parameter for parallel work

**Key insight**: Getting user sign-off before implementation prevents wasted effort. The system explicitly prefers planning over jumping into code.

## 4. Task Management (TodoWrite)

Built-in todo tracking with three states:

- `pending` - Not started
- `in_progress` - Currently working (limit ONE at a time)
- `completed` - Finished

### Usage Guidelines

- Use for 3+ step tasks
- Mark complete IMMEDIATELY after finishing
- Track progress gives user visibility
- Break complex tasks into smaller steps

**Key insight**: The one-in-progress-at-a-time rule prevents context switching and ensures focus.

## 5. Safety & Guardrails

### Git Safety Protocol

- Never update git config
- Never force push to main/master
- Never skip hooks (--no-verify)
- Never commit unless explicitly asked
- Always check authorship before amend
- Use HEREDOC for commit messages (formatting)

### Security Policies

- Refuse destructive techniques
- Require authorization context for dual-use tools
- Never generate/guess URLs
- Warn about secrets in commits (.env, credentials)

### File Safety

- Write tool fails if file wasn't read first
- Edit requires unique match or explicit replace_all
- Never create files unless necessary
- Prefer editing over creating new files

## 6. Tone & Communication

### Professional Objectivity

- Technical accuracy over validation
- No excessive praise ("You're absolutely right")
- Disagree when necessary
- Investigate before confirming beliefs
- No emojis unless requested

### Planning Without Timelines

- Never suggest time estimates
- Focus on what, not when
- Let users decide scheduling

### Communication Rules

- Output text directly, never via echo/bash
- Short, concise responses (CLI context)
- GitHub-flavored markdown
- Reference code as `file_path:line_number`

## 7. Context Management

### Unlimited Context

- Automatic summarization enables unlimited context
- Never claim "task too large" or "context limits"
- Complete tasks fully, don't stop mid-task

### Efficient Tool Usage

- Parallel tool calls when no dependencies
- Use Task/Explore for open-ended searches
- Speculative parallel reads for potentially useful files

## 8. User Interaction (AskUserQuestion)

Structured questioning with:

- 1-4 questions per call
- 2-4 options per question
- Auto "Other" option for custom input
- `multiSelect` for non-exclusive choices
- Recommended option marked and listed first

## 9. Key Design Principles

1. **Read before modify** - Never propose changes to unread code
2. **Avoid over-engineering** - Only changes directly requested
3. **No premature abstraction** - Three similar lines > abstraction
4. **Delete unused code** - No backwards-compatibility hacks
5. **Validate at boundaries** - Trust internal code, validate user input
6. **Simple solutions** - Minimum complexity for current task

## 10. Architecture Implications for Building Agents

### Tool Design

- Create specialized tools rather than generic execution
- Enforce read-before-write patterns
- Make dangerous operations explicit (replace_all flag)

### Agent Hierarchy

- Spawn read-only agents for exploration
- Full-capability agents only when needed
- Background execution for parallel work
- Resume capability for long-running tasks

### User Experience

- Explicit planning phase for complex tasks
- Todo tracking for visibility
- Structured questions for decisions
- File:line references for navigation

### Safety First

- Restrict bash to non-file operations
- Require explicit user requests for commits
- Multiple layers of confirmation for destructive ops

