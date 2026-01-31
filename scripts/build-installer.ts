import { join } from "node:path";
import { z } from "zod";

const configSchema = z.object({
  appName: z.string().min(1),
  binName: z.string().min(1),
  repoOwner: z.string().min(1),
  repoName: z.string().min(1),
  installDir: z.string().min(1),
  installDomain: z.string().min(1),
  installPath: z.string().min(1),
  blobPublicBaseUrl: z.string().min(1),
});

const rootDir = process.cwd();
const configPath = join(rootDir, "installer.config.json");
const templatePath = join(rootDir, "scripts", "install.template.sh");
const outputPath = join(rootDir, "apps", "web", "public", "install");

async function main() {
  const configText = await Bun.file(configPath).text();
  const parsedConfig: unknown = JSON.parse(configText);
  const config = configSchema.parse(parsedConfig);

  const template = await Bun.file(templatePath).text();

  const replacements: Record<string, string> = {
    __APP_NAME__: config.appName,
    __BIN_NAME__: config.binName,
    __REPO_OWNER__: config.repoOwner,
    __REPO_NAME__: config.repoName,
    __INSTALL_DIR__: config.installDir,
    __INSTALL_DOMAIN__: config.installDomain,
    __INSTALL_PATH__: config.installPath,
    __BLOB_PUBLIC_BASE_URL__: config.blobPublicBaseUrl,
  };

  let output = template;
  for (const [token, value] of Object.entries(replacements)) {
    output = output.split(token).join(value);
  }

  const missingTokens = Object.keys(replacements).filter((token) =>
    output.includes(token),
  );
  if (missingTokens.length > 0) {
    throw new Error(
      `Installer template contains unresolved tokens: ${missingTokens.join(", ")}`,
    );
  }

  await Bun.write(outputPath, output);
  console.log(`Wrote installer to ${outputPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
