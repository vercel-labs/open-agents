const testPatterns = ["**/*.test.ts", "**/*.test.tsx"];

function isIgnoredPath(path: string): boolean {
  return path.startsWith("node_modules/") || path.startsWith(".");
}

async function collectTestFiles(): Promise<string[]> {
  const files = new Set<string>();

  for (const pattern of testPatterns) {
    const glob = new Bun.Glob(pattern);
    for await (const path of glob.scan(".")) {
      if (isIgnoredPath(path)) {
        continue;
      }
      files.add(path);
    }
  }

  return [...files].sort((a, b) => a.localeCompare(b));
}

async function runTestsIndividually(files: string[]): Promise<void> {
  for (const file of files) {
    console.log(`\nRunning ${file}`);

    const process = Bun.spawn(["bun", "test", file], {
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await process.exited;
    if (exitCode !== 0) {
      throw new Error(`Test failed: ${file}`);
    }
  }
}

async function main() {
  const files = await collectTestFiles();

  if (files.length === 0) {
    console.log("No test files found.");
    return;
  }

  console.log(`Running ${files.length} test files in isolated processes...`);
  await runTestsIndividually(files);
  console.log("\nAll isolated tests passed.");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
