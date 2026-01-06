import * as readline from "readline";
import { deepAgent } from "../agent";
import { printStream } from "./utils/print-stream";

export interface ReplOptions {
  workingDirectory?: string;
  prompt?: string;
}

export async function startRepl(options: ReplOptions = {}): Promise<void> {
  const { workingDirectory = process.cwd(), prompt: promptPrefix = ">" } =
    options;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("Deep Agent REPL");
  console.log("Type 'exit' or 'quit' to exit, 'clear' to reset state");
  console.log("");

  const askQuestion = (): void => {
    rl.question(`${promptPrefix} `, async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        askQuestion();
        return;
      }

      if (trimmed === "exit" || trimmed === "quit") {
        console.log("Goodbye!");
        rl.close();
        return;
      }

      if (trimmed === "clear") {
        console.log("State cleared.\n");
        askQuestion();
        return;
      }

      if (trimmed === "state") {
        console.log("\nCurrent State:");
        console.log("  No persisted agent state");
        console.log("");
        askQuestion();
        return;
      }

      try {
        const result = await deepAgent.stream({
          prompt: trimmed,
          options: {
            workingDirectory,
          },
        });

        await printStream(result);
        console.log("\n");
      } catch (error) {
        console.error(
          "\nError:",
          error instanceof Error ? error.message : error,
        );
        console.log("");
      }

      askQuestion();
    });
  };

  askQuestion();
}
