import { createOpenHarnessAgent } from "@open-harness/agent";
import { DEFAULT_WORKING_DIRECTORY } from "@/lib/sandbox/config";

// Configure the agent here - single source of truth for the web app
export const webAgent = createOpenHarnessAgent({
  sandbox: {
    state: {
      type: "vercel",
    },
    workingDirectory: DEFAULT_WORKING_DIRECTORY,
  },
});
