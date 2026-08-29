/**
 * Shared helpers for the Node-executed CLI scripts in `scripts/`.
 */

export function requireOptionValue(
  argv: string[],
  index: number,
  option: string,
): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${option}.`);
  }

  return value;
}

/**
 * Run a script entry point: exit 0 on success, print the error message and
 * exit 1 on failure. `process.exit(0)` is explicit so lingering SDK handles
 * cannot keep the process alive after a successful run.
 */
export function runMain(main: () => Promise<void>): void {
  main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
