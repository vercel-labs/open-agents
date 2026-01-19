# Plan: Sandbox Inactivity-Based Timeout

## Summary

Change from a fixed sandbox countdown timer to an inactivity-based stop mechanism:
- **Server-side:** Start sandbox with 5-hour timeout (instead of 5 minutes)
- **Client-side:** Track time since last message; stop sandbox after 10 minutes of inactivity

## Current Behavior

1. Sandbox created with 5-minute timeout (`DEFAULT_TIMEOUT = 300_000`)
2. Client counts down from `createdAt + timeout`
3. Warning appears at 1 minute remaining
4. Auto-stop triggers when countdown reaches 0

## Proposed Behavior

1. Sandbox created with 5-hour timeout (18,000,000 ms)
2. Client tracks time since last message (user or assistant)
3. Warning appears when idle for 9 minutes (1 minute before auto-stop)
4. Auto-stop triggers after 10 minutes of inactivity
5. Any new message resets the inactivity timer

## Files to Modify

### 1. `apps/web/app/api/sandbox/route.ts`

**Change:** Update `DEFAULT_TIMEOUT` from 5 minutes to 5 hours

```typescript
// Before
const DEFAULT_TIMEOUT = 300_000; // 5 minutes

// After
const DEFAULT_TIMEOUT = 5 * 60 * 60 * 1000; // 5 hours
```

### 2. `apps/web/app/tasks/[id]/task-detail-content.tsx`

**Changes:**

1. **Add inactivity timeout constant:**
   ```typescript
   const INACTIVITY_TIMEOUT = 10 * 60 * 1000; // 10 minutes
   const INACTIVITY_WARNING_THRESHOLD = 60 * 1000; // Show warning 1 minute before
   ```

2. **Replace `useSandboxTimeRemaining` hook with `useInactivityTimer`:**
   - Track time since last message instead of sandbox expiration
   - Accept `messages` array as dependency to detect activity
   - Calculate `lastActivityTime` from the most recent message's timestamp
   - Return `timeUntilInactiveStop` (how long until 10 min inactivity is reached)

3. **Update warning UI:**
   - Show "Pausing due to inactivity in {seconds}s" instead of countdown text
   - Keep the same "Extend" and "X" button behavior

4. **Update auto-stop trigger:**
   - Trigger when `timeUntilInactiveStop <= 0` instead of `timeRemaining <= 0`

### 3. Message timestamp tracking

**Current state:** Messages have `createdAt` timestamps in the DB, but we need to access them in the component.

**Options:**
- A) Use `Date.now()` when message is added to state (simpler, already in memory)
- B) Track last activity timestamp separately in component state

**Recommendation:** Option A - track `lastActivityTime` in component state, reset it whenever `messages.length` changes or a new message appears.

## Implementation Details

### New `useInactivityTimer` Hook

```typescript
function useInactivityTimer(
  sandboxInfo: SandboxInfo | null,
  messages: WebAgentUIMessage[]
) {
  const [lastActivityTime, setLastActivityTime] = useState<number>(Date.now());
  const [timeUntilStop, setTimeUntilStop] = useState<number | null>(null);

  // Reset activity time when messages change
  useEffect(() => {
    if (messages.length > 0) {
      setLastActivityTime(Date.now());
    }
  }, [messages.length]);

  // Calculate time until inactivity stop
  useEffect(() => {
    if (!sandboxInfo) {
      setTimeUntilStop(null);
      return;
    }

    const updateTime = () => {
      const inactiveAt = lastActivityTime + INACTIVITY_TIMEOUT;
      const remaining = inactiveAt - Date.now();
      setTimeUntilStop(remaining > 0 ? remaining : 0);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [sandboxInfo, lastActivityTime]);

  return { timeUntilStop, resetActivity: () => setLastActivityTime(Date.now()) };
}
```

### Warning Threshold Update

```typescript
// Before
const showTimeWarning = timeRemaining !== null && timeRemaining < 60000;

// After
const showInactivityWarning =
  timeUntilStop !== null &&
  timeUntilStop < INACTIVITY_WARNING_THRESHOLD;
```

### Auto-Stop Trigger Update

```typescript
// Before
useEffect(() => {
  if (timeRemaining !== null && timeRemaining <= 0 && ...) {
    onSaveAndKill();
  }
}, [timeRemaining, ...]);

// After
useEffect(() => {
  if (timeUntilStop !== null && timeUntilStop <= 0 && ...) {
    onSaveAndKill();
  }
}, [timeUntilStop, ...]);
```

## Edge Cases

1. **Page refresh:** Activity timer resets to current time (acceptable - user just came back)
2. **Extend button:** Resets the inactivity timer (call `resetActivity()`)
3. **No sandbox yet:** Timer is null, no warning shown
4. **Sandbox reconnection:** Activity timer starts fresh on reconnect

## Verification

1. Start a task and create a sandbox
2. Verify sandbox doesn't show countdown timer
3. Wait 9 minutes without sending messages
4. Verify "Pausing due to inactivity" warning appears
5. Send a message and verify warning disappears
6. Wait another 9 minutes and verify warning reappears
7. Click "Extend" and verify timer resets
8. Wait 10 minutes total without activity and verify auto-stop triggers
