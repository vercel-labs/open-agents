# Type Narrowing Over Casting

This document describes a refactoring pattern applied to improve type safety by replacing casts with proper type narrowing and derived types.

## Problem

Code was using loose inline types and `as` casts instead of leveraging TypeScript's type system properly. This leads to:

- Lost type safety (casts bypass type checking)
- Duplicated type definitions that drift from source
- Missed opportunities for TypeScript to catch errors

## Anti-patterns identified

### 1. Loose inline types instead of derived types

**Bad:**
```typescript
function TaskRenderer({ part }: {
  part: { input?: unknown; state: string; output?: unknown };
}) {
  const input = part.input as TaskInput;  // cast required
```

**Good:**
```typescript
function TaskRenderer({ part }: {
  part: TaskToolUIPart;  // derived from tool definition
}) {
  const input = part.input;  // properly typed, no cast
```

### 2. Switching on derived strings instead of discriminants

**Bad:**
```typescript
const toolName = getToolName(part);  // returns string
switch (toolName) {
  case "task":
    return <TaskRenderer part={part} />;  // part not narrowed
```

**Good:**
```typescript
switch (part.type) {  // discriminant field
  case "tool-task":
    return <TaskRenderer part={part} />;  // part narrowed to TaskToolUIPart
```

### 3. Local type definitions instead of deriving from source

**Bad:**
```typescript
type MessagePart = {
  type: string;
  toolCallId?: string;
  input?: Record<string, unknown>;
};
```

**Good:**
```typescript
type SubagentMessagePart = SubagentUIMessage["parts"][number];
```

### 4. Casts instead of type narrowing

**Bad:**
```typescript
const input = part.input as Record<string, unknown>;
if (input?.filePath) { ... }
```

**Good:**
```typescript
switch (part.type) {
  case "tool-read":
    return part.input?.filePath;  // TypeScript knows input shape
  case "tool-bash":
    return part.input?.command;
```

## Files refactored

- `apps/web/components/tool-call/renderers/task-renderer.tsx` - Used `TaskToolUIPart` and `SubagentMessagePart` instead of loose types
- `apps/web/components/tool-call/tool-call.tsx` - Switch on `part.type` instead of derived `toolName`
- `packages/tui/components/task-group-view.tsx` - Removed cast, types flow from `TaskToolUIPart`
- `apps/web/components/task-group-view.tsx` - Same fix

## Prompt for finding similar issues

> Look for patterns where we cast with `as` instead of using type narrowing. Also find places where we define local types (like `type MessagePart = {...}`) instead of deriving them from source types. Check for switches on string values derived from objects (like `getToolName(part)`) instead of switching on discriminant fields (like `part.type`). The fix is to use properly typed imports, derive types with indexed access (`Type["field"][number]`), and narrow with discriminants or type guards.

## Key principles

1. **Derive types from source** - Use indexed access types (`Type["field"]`) rather than redefining
2. **Switch on discriminants** - Use `part.type` not `getToolName(part)` for proper narrowing
3. **Avoid casts** - If you need `as`, the types aren't flowing properly
4. **Use type guards** - `isToolUIPart(part)` narrows the type for subsequent code
