import { cp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";

const configSchema = z.object({
  binName: z.string().min(1),
  installDomain: z.string().min(1),
});

type TargetSpec = {
  os: "darwin" | "linux" | "windows";
  arch: "x64" | "arm64";
  bunTarget: string;
  archiveExt: ".zip" | ".tar.gz";
  exeSuffix: "" | ".exe";
  opentuiPackage: string;
};

type CliOptions = {
  dir: string;
  entry: string;
  targets: string[];
};

const DEFAULT_TARGETS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "windows-x64",
];

const TARGETS: Record<string, TargetSpec> = {
  "darwin-arm64": {
    os: "darwin",
    arch: "arm64",
    bunTarget: "bun-darwin-arm64",
    archiveExt: ".zip",
    exeSuffix: "",
    opentuiPackage: "@opentui/core-darwin-arm64",
  },
  "darwin-x64": {
    os: "darwin",
    arch: "x64",
    bunTarget: "bun-darwin-x64",
    archiveExt: ".zip",
    exeSuffix: "",
    opentuiPackage: "@opentui/core-darwin-x64",
  },
  "linux-arm64": {
    os: "linux",
    arch: "arm64",
    bunTarget: "bun-linux-arm64",
    archiveExt: ".tar.gz",
    exeSuffix: "",
    opentuiPackage: "@opentui/core-linux-arm64",
  },
  "linux-x64": {
    os: "linux",
    arch: "x64",
    bunTarget: "bun-linux-x64",
    archiveExt: ".tar.gz",
    exeSuffix: "",
    opentuiPackage: "@opentui/core-linux-x64",
  },
  "windows-x64": {
    os: "windows",
    arch: "x64",
    bunTarget: "bun-windows-x64",
    archiveExt: ".zip",
    exeSuffix: ".exe",
    opentuiPackage: "@opentui/core-win32-x64",
  },
};

const usage = () => {
  console.log(`Usage:
  bun run scripts/build-release-artifacts.ts [options]

Options:
  -d, --dir <path>       Output directory (default: dist)
  -e, --entry <path>     CLI entrypoint (default: apps/cli/index.ts)
  -t, --targets <list>   Comma-separated targets (default: ${DEFAULT_TARGETS.join(", ")})
  -h, --help             Show this help message\n`);
};

function parseArgs(argv: string[]): CliOptions {
  const options: Partial<CliOptions> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        usage();
        process.exit(0);
      case "-d":
      case "--dir": {
        const value = argv[i + 1];
        if (!value) {
          throw new Error("Missing value for --dir");
        }
        options.dir = value;
        i += 1;
        break;
      }
      case "-e":
      case "--entry": {
        const value = argv[i + 1];
        if (!value) {
          throw new Error("Missing value for --entry");
        }
        options.entry = value;
        i += 1;
        break;
      }
      case "-t":
      case "--targets": {
        const value = argv[i + 1];
        if (!value) {
          throw new Error("Missing value for --targets");
        }
        options.targets = value.split(",").map((target) => target.trim());
        i += 1;
        break;
      }
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return {
    dir: options.dir ?? "dist",
    entry: options.entry ?? "apps/cli/index.ts",
    targets: options.targets ?? DEFAULT_TARGETS,
  };
}

async function ensureCommand(command: string) {
  try {
    await Bun.$`command -v ${command}`;
  } catch {
    throw new Error(`Missing required tool: ${command}`);
  }
}

async function ensureOpentuiPackage(packageName: string) {
  const packagePath = join("node_modules", packageName, "package.json");
  const exists = await Bun.file(packagePath).exists();
  if (exists) {
    return;
  }
  throw new Error(
    `Missing ${packageName}. Install it with: bun add -D ${packageName}`,
  );
}

async function copyTreeSitterWorker(stageDir: string) {
  const sourcePath = join(
    "node_modules",
    "@opentui",
    "core",
    "parser.worker.js",
  );
  const exists = await Bun.file(sourcePath).exists();
  if (!exists) {
    throw new Error(
      "Missing @opentui/core/parser.worker.js. Run bun install before building release artifacts.",
    );
  }

  const destinationPath = join(stageDir, "parser.worker.js");
  await Bun.write(destinationPath, Bun.file(sourcePath));
}

async function copyWebTreeSitter(stageDir: string) {
  const sourceDir = join("node_modules", "web-tree-sitter");
  const exists = await Bun.file(join(sourceDir, "package.json")).exists();
  if (!exists) {
    throw new Error(
      "Missing web-tree-sitter. Run bun install before building release artifacts.",
    );
  }

  const destinationRoot = join(stageDir, "node_modules");
  const destinationDir = join(destinationRoot, "web-tree-sitter");
  await mkdir(destinationRoot, { recursive: true });
  await cp(sourceDir, destinationDir, { recursive: true, force: true });
}

async function main() {
  const options = parseArgs(Bun.argv.slice(2));
  const isWindows = process.platform === "win32";

  const configText = await Bun.file("installer.config.json").text();
  const parsedConfig: unknown = JSON.parse(configText);
  const config = configSchema.parse(parsedConfig);

  const cliConfigPath = join("apps", "cli", "auth", "config.generated.ts");
  const cliConfigContents = `export const DEFAULT_WEB_APP_URL = "https://${config.installDomain}";\n`;
  await Bun.write(cliConfigPath, cliConfigContents);

  const invalidTargets = options.targets.filter(
    (target) => !(target in TARGETS),
  );
  if (invalidTargets.length > 0) {
    throw new Error(`Unknown targets: ${invalidTargets.join(", ")}`);
  }

  const needsZip = options.targets.some(
    (target) => TARGETS[target]?.archiveExt === ".zip",
  );
  const needsTar = options.targets.some(
    (target) => TARGETS[target]?.archiveExt === ".tar.gz",
  );

  if (needsZip && !isWindows) {
    await ensureCommand("zip");
  }
  if (needsTar) {
    await ensureCommand("tar");
  }

  const outputDir = resolve(options.dir);
  const stageRoot = join(outputDir, "stage");

  await Bun.$`mkdir -p ${stageRoot}`;

  for (const targetKey of options.targets) {
    const target = TARGETS[targetKey];
    await ensureOpentuiPackage(target.opentuiPackage);
    const stageDir = join(stageRoot, `${target.os}-${target.arch}`);
    const binaryName = `${config.binName}${target.exeSuffix}`;
    const outputBinary = join(stageDir, binaryName);

    await rm(stageDir, { recursive: true, force: true });
    await Bun.$`mkdir -p ${stageDir}`;
    await Bun.$`bun build ${options.entry} --compile --target=${target.bunTarget} --outfile ${outputBinary}`;
    await copyTreeSitterWorker(stageDir);
    await copyWebTreeSitter(stageDir);

    const archiveName = `${config.binName}-${target.os}-${target.arch}${target.archiveExt}`;
    const archivePath = join(outputDir, archiveName);

    if (target.archiveExt === ".tar.gz") {
      await Bun.$`tar -czf ${archivePath} -C ${stageDir} .`;
    } else {
      if (isWindows) {
        await Bun.$`powershell -NoProfile -Command Compress-Archive -Path "${stageDir}\\*" -DestinationPath "${archivePath}" -Force`;
      } else {
        await Bun.$`bash -c ${`cd "${stageDir}" && zip -r "${archivePath}" . -x "*.DS_Store"`}`;
      }
    }

    console.log(`Built ${archivePath}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
