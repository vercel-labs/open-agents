import type { AgentMode } from "../types";

export const sharedContext: {
  workingDirectory: string;
  mode: AgentMode;
} = {
  workingDirectory: process.cwd(),
  mode: "interactive",
};
