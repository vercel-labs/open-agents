import type { VercelConfig } from "@vercel/config/v1";

const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "";

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
