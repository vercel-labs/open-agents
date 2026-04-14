/**
 * Shared Vercel BotID server-side configuration.
 *
 * `extraAllowedHosts` tells BotID which frontend origins are permitted to
 * call the protected endpoints — anything on our own domains plus Vercel
 * preview / sandbox URLs.
 */
export const botIdConfig = {
  advancedOptions: {
    extraAllowedHosts: [
      "vercel.com",
      "*.vercel.com",
      "*.vercel.dev",
      "*.vercel.run",
      "*.open-agents.dev",
    ],
  },
};
