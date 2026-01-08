import { createTUI } from "./src/tui";
import { connectVercelSandbox } from "./src/agent/sandbox";

async function main() {
  const args = process.argv.slice(2);
  const initialPrompt = args.length > 0 ? args.join(" ") : undefined;

  console.log("Creating Vercel sandbox...");

  const sandbox = await connectVercelSandbox({
    // Optional: clone a repo
    // source: {
    //   url: "https://github.com/owner/repo",
    //   branch: "main",
    // },
    vcpus: 2,
    timeout: 300_000,
  });

  console.log("Sandbox ID:", sandbox.id);
  console.log("Working directory:", sandbox.workingDirectory);
  console.log("");

  try {
    await createTUI({
      initialPrompt,
      workingDirectory: sandbox.workingDirectory,
      header: {
        name: "Deep Agent (Vercel Sandbox)",
        version: "0.1.0",
      },
      agentOptions: {
        workingDirectory: sandbox.workingDirectory,
        sandbox,
      },
    });
  } finally {
    console.log("\nStopping sandbox...");
    await sandbox.stop();
  }
}

main().catch(console.error);
