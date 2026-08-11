import type { NextConfig } from "next";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withBotId } from "botid/next/config";
import { withWorkflow } from "workflow/next";

const appDir = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  outputFileTracingRoot: join(appDir, "../.."),
  // The internal harness-runner route uploads each harness's in-sandbox bridge
  // script at runtime, so those `dist/bridge` assets must be traced into the
  // route's serverless bundle. The harness packages are marked external
  // (serverExternalPackages) so they load from traced node_modules instead of
  // being bundled, and the pnpm-store glob patterns below are load-bearing and
  // layout-sensitive: they must match the `.pnpm/<name>@<version>` directory
  // layout for tracing to find the files. `@ai-sdk/harness-pi` ships no
  // `dist/bridge` directory (verified in node_modules), which is why it has no
  // entry in outputFileTracingIncludes.
  outputFileTracingIncludes: {
    "/api/internal/harness-runner": [
      "../../node_modules/.pnpm/@ai-sdk+harness-claude-code@*/node_modules/@ai-sdk/harness-claude-code/dist/bridge/**/*",
      "../../node_modules/.pnpm/@ai-sdk+harness-codex@*/node_modules/@ai-sdk/harness-codex/dist/bridge/**/*",
    ],
  },
  serverExternalPackages: [
    "@ai-sdk/harness",
    "@ai-sdk/harness-claude-code",
    "@ai-sdk/harness-codex",
    "@ai-sdk/harness-pi",
    "@ai-sdk/sandbox-vercel",
  ],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
      {
        protocol: "https",
        hostname: "vercel.com",
      },
      {
        protocol: "https",
        hostname: "*.vercel.com",
      },
    ],
  },
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default withWorkflow(withBotId(nextConfig));
