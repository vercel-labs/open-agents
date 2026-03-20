# Tool Approval System

This document explains the current bash safety model used in `packages/agent`.

## Overview

The agent no longer has multiple runtime modes or configurable approval policies. Instead, bash safety is enforced directly by the bash tool with a simple default rule:

- safe read-only commands can run without approval
- dangerous or unknown commands require approval
- commands that escape the sandbox working directory require approval

This is the only behavior needed to prevent obviously dangerous operations such as `rm -rf`.

## Bash Approval Flow

```text
Bash tool called
    ↓
Is cwd outside working directory? ── Yes ──→ Needs approval
    ↓ No
Does the command match a dangerous or unknown pattern? ── Yes ──→ Needs approval
    ↓ No
Auto-approve
```

## Safe Commands

The bash tool auto-approves a small set of read-only command prefixes such as:

- `ls`
- `find`
- `grep`
- `rg`
- `git status`
- `git diff`
- `git log`
- `pwd`
- `echo`

See `packages/agent/tools/bash.ts` for the full list.

## Dangerous Commands

The bash tool requires approval for dangerous patterns including commands like:

- `rm`
- `mv`
- `cp`
- `mkdir`
- `touch`
- `chmod`
- `chown`
- `sudo`
- destructive git commands
- package installation commands
- shell redirects, pipes, and command chaining

Unknown commands also require approval by default.

## Subagents

Subagents follow the exact same bash safety policy as the main agent. They no longer bypass dangerous-command approval.

## Key Files

| File | Purpose |
| --- | --- |
| `packages/agent/tools/bash.ts` | Hardcoded bash safety policy |
| `packages/agent/tools/utils.ts` | Sandbox context helpers |
| `packages/agent/subagents/executor.ts` | Executor subagent context |
| `packages/agent/subagents/explorer.ts` | Explorer subagent context |
