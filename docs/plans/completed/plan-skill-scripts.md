# Plan: Implement Script Invocation Support for Skills

## Overview

Skills can have bundled scripts in a `scripts/` directory. For Claude to execute these scripts, it needs to know the skill's base directory so it can construct full paths like `bash /path/to/skill/scripts/validate.sh`.

## Current State

- Skills are discovered and loaded from `.claude/skills/` and `.agents/skills/` directories
- Frontmatter is parsed with name, description, and options
- Body content is extracted and `$ARGUMENTS` is substituted
- **Missing**: Claude doesn't know where the skill directory is located

## Implementation

### Step 1: Add helper function to `loader.ts`

Add a function to inject the skill directory into the body content:

```typescript
/**
 * Inject skill directory path into the body content.
 * This allows Claude to construct full paths to scripts and resources.
 *
 * @param body - Skill body content
 * @param skillDir - Absolute path to the skill directory
 * @returns Body with skill directory info prepended
 */
export function injectSkillDirectory(body: string, skillDir: string): string {
  return `Skill directory: ${skillDir}\n\n${body}`;
}
```

### Step 2: Update `skill.ts` to use the helper

In the `execute` function, after extracting the body, inject the skill directory:

```typescript
// Parse and extract body (skip frontmatter)
const body = extractSkillBody(fileContent);

// Inject skill directory for script access
const bodyWithDir = injectSkillDirectory(body, foundSkill.path);

// Substitute arguments
const content = substituteArguments(bodyWithDir, args);
```

### Step 3: Update imports in `skill.ts`

```typescript
import { extractSkillBody, substituteArguments, injectSkillDirectory } from "../skills/loader";
```

## Files to Modify

1. `packages/agent/skills/loader.ts` - Add `injectSkillDirectory` function
2. `packages/agent/tools/skill.ts` - Use the new function when processing skill content

## How It Works

When a skill is invoked:

1. Skill file is read from disk
2. Frontmatter is stripped, body extracted
3. **NEW**: Skill directory path is prepended to body
4. `$ARGUMENTS` placeholders are substituted
5. Content returned to Claude

Claude then sees:
```
Skill directory: /Users/user/.claude/skills/my-skill

[Original SKILL.md body content]
```

Claude can construct full paths: `bash /Users/user/.claude/skills/my-skill/scripts/validate.sh`

## Example Skill Usage

A skill with scripts:
```
my-skill/
├── SKILL.md
└── scripts/
    └── validate.sh
```

SKILL.md body:
```markdown
## Validation

Run the validation script to check your changes:

bash scripts/validate.sh
```

After injection, Claude sees:
```markdown
Skill directory: /path/to/my-skill

## Validation

Run the validation script to check your changes:

bash scripts/validate.sh
```

Claude executes: `bash /path/to/my-skill/scripts/validate.sh`

## Verification

1. Run `turbo typecheck --filter=@open-harness/agent` to verify types
2. Test with a skill that has a scripts directory
