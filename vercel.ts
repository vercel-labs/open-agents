const bypassSecret = "$VERCEL_AUTOMATION_BYPASS_SECRET";

const config = {
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

export default config;
