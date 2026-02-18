import type { VercelConfig } from "@vercel/config/v1";
import { deploymentEnv } from "@vercel/config/v1";

const bypassSecret = deploymentEnv("VERCEL_AUTOMATION_BYPASS_SECRET");

export const config: VercelConfig = {
  headers: [
    {
      source: "/api/(.*)",
      headers: [
        {
          key: "x-vercel-protection-bypass",
          value: bypassSecret,
        },
      ],
    },
    {
      source: "/install",
      headers: [
        {
          key: "x-vercel-protection-bypass",
          value: bypassSecret,
        },
      ],
    },
  ],
};
