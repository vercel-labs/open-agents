import { spawn } from "node:child_process";
import { glob } from "node:fs/promises";

const testPatterns = ["**/*.test.ts", "**/*.test.tsx"];

function isIgnoredPath(path: string): boolean {
  return path.startsWith("node_modules/") || path.startsWith(".");
}

async function collectTestFiles(): Promise<string[]> {
  const files = new Set<string>();

  for (const pattern of testPatterns) {
    for await (const path of glob(pattern)) {
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

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const childProcess = spawn("bun", ["test", file], {
        stdio: "inherit",
      });

      childProcess.on("error", reject);
      childProcess.on("close", resolve);
    });

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
