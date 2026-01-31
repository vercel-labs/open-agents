import { rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const configSchema = z.object({
  binName: z.string().min(1),
  installDir: z.string().min(1),
});

type HostTarget = {
  os: "darwin" | "linux" | "windows";
  arch: "x64" | "arm64";
  target: string;
};

function resolveHostTarget(): HostTarget {
  let os: HostTarget["os"];
  switch (process.platform) {
    case "darwin":
      os = "darwin";
      break;
    case "linux":
      os = "linux";
      break;
    case "win32":
      os = "windows";
      break;
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }

  let arch: HostTarget["arch"];
  switch (process.arch) {
    case "x64":
      arch = "x64";
      break;
    case "arm64":
      arch = "arm64";
      break;
    default:
      throw new Error(`Unsupported architecture: ${process.arch}`);
  }

  return { os, arch, target: `${os}-${arch}` };
}

async function main() {
  const configText = await Bun.file("installer.config.json").text();
  const parsedConfig: unknown = JSON.parse(configText);
  const config = configSchema.parse(parsedConfig);

  const host = resolveHostTarget();
  const distDir = "dist";
  const stageDir = join(distDir, "stage", `${host.os}-${host.arch}`);
  const binaryName = `${config.binName}${host.os === "windows" ? ".exe" : ""}`;
  const binaryPath = join(stageDir, binaryName);

  console.log(`Building ${host.target} release artifact...`);
  await Bun.$`bun run scripts/build-release-artifacts.ts --targets ${host.target} --dir ${distDir}`;

  const binaryExists = await Bun.file(binaryPath).exists();
  if (!binaryExists) {
    throw new Error(`Expected binary not found: ${binaryPath}`);
  }

  await Bun.$`bun run scripts/build-installer.ts`;

  if (host.os === "windows") {
    console.log("Local install script uses bash. Run in WSL or Git Bash.");
    console.log(`Binary is at: ${binaryPath}`);
    return;
  }

  const homeDir = process.env.HOME;
  const resolvedInstallDir = homeDir
    ? join(homeDir, config.installDir)
    : `$HOME/${config.installDir}`;
  if (homeDir) {
    console.log(`Wiping local install dir: ${resolvedInstallDir}`);
    await rm(resolvedInstallDir, { recursive: true, force: true });
  } else {
    console.warn("HOME is not set. Skipping local install dir cleanup.");
  }

  console.log("Installing from local binary (no PATH changes)...");
  await Bun.$`bash apps/web/public/install --binary ${binaryPath} --no-modify-path`;

  const installDir = resolvedInstallDir;

  console.log("Done.");
  console.log(`Run: ${join(installDir, config.binName)} --help`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
