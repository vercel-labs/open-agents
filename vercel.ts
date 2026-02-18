import { routes, type VercelConfig } from "@vercel/config/v1";

const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

const bypassHeaders = bypassSecret
  ? [
      routes.header("/api/(.*)", [
        {
          key: "x-vercel-protection-bypass",
          value: bypassSecret,
        },
      ]),
      routes.header("/install", [
        {
          key: "x-vercel-protection-bypass",
          value: bypassSecret,
        },
      ]),
    ]
  : [];

export const config: VercelConfig = {
  headers: bypassHeaders,
};
