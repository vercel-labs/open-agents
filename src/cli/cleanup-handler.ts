type CleanupFn = () => Promise<void> | void;

let cleanupFn: CleanupFn | undefined;
let isCleaningUp = false;
let handlersRegistered = false;

async function runCleanup() {
  if (isCleaningUp || !cleanupFn) return;
  isCleaningUp = true;

  try {
    await cleanupFn();
  } catch {
    // Ignore cleanup errors during shutdown
  }
}

function handleSignal() {
  runCleanup().finally(() => {
    process.exit(0);
  });
}

/**
 * Register a cleanup function to run on SIGINT/SIGTERM.
 * Only one cleanup function can be registered at a time.
 */
export function onCleanup(fn: CleanupFn) {
  cleanupFn = fn;

  if (!handlersRegistered) {
    handlersRegistered = true;
    process.on("SIGINT", handleSignal);
    process.on("SIGTERM", handleSignal);
  }
}

/**
 * Manually trigger cleanup (e.g., in a finally block).
 * Safe to call multiple times - will only run once.
 */
export async function cleanup() {
  await runCleanup();
}
