import { join } from "node:path";
import { put } from "@vercel/blob";
import { z } from "zod";

const configSchema = z.object({
  binName: z.string().min(1),
  blobPublicBaseUrl: z.string().min(1),
});

type CliOptions = {
  version: string;
  dir: string;
  prefix?: string;
  targets: string[];
  skipLatest: boolean;
  onlyLatest: boolean;
};

const usage = () => {
  console.log(`Usage:
  bun run scripts/upload-release-to-blob.ts --version <version> [--dir <path>] [--prefix <path>] [--targets <list>] [--skip-latest] [--only-latest]

Options:
  -v, --version    Release version (e.g. 1.2.3 or v1.2.3)
  -d, --dir        Directory containing built archives (default: dist)
  -p, --prefix     Optional blob path prefix (overrides base URL path)
  -t, --targets    Comma-separated targets (default: all)
      --skip-latest  Skip writing the latest pointer
      --only-latest  Only write the latest pointer (skip artifacts)
  -h, --help       Show this help message`);
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
      case "-v":
      case "--version": {
        const value = argv[i + 1];
        if (!value) {
          throw new Error("Missing value for --version");
        }
        options.version = value;
        i += 1;
        break;
      }
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
      case "-p":
      case "--prefix": {
        const value = argv[i + 1];
        if (!value) {
          throw new Error("Missing value for --prefix");
        }
        options.prefix = value;
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
      case "--skip-latest":
        options.skipLatest = true;
        break;
      case "--only-latest":
        options.onlyLatest = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.version) {
    throw new Error("--version is required");
  }

  return {
    version: options.version,
    dir: options.dir ?? "dist",
    prefix: options.prefix,
    targets: options.targets ?? [
      "linux-x64",
      "linux-arm64",
      "darwin-x64",
      "darwin-arm64",
      "windows-x64",
    ],
    skipLatest: options.skipLatest ?? false,
    onlyLatest: options.onlyLatest ?? false,
  };
}

function normalizePath(input: string): string {
  return input.replace(/^\/+|\/+$/g, "");
}

function contentTypeFor(filename: string): string {
  if (filename.endsWith(".tar.gz")) {
    return "application/gzip";
  }
  if (filename.endsWith(".zip")) {
    return "application/zip";
  }
  return "application/octet-stream";
}

async function main() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error("BLOB_READ_WRITE_TOKEN is required to upload releases.");
  }

  const options = parseArgs(Bun.argv.slice(2));
  const version = options.version.replace(/^v/, "");
  if (!version) {
    throw new Error("Version must be non-empty.");
  }

  const configText = await Bun.file("installer.config.json").text();
  const parsedConfig: unknown = JSON.parse(configText);
  const config = configSchema.parse(parsedConfig);

  const baseUrl = new URL(config.blobPublicBaseUrl);
  const basePath = normalizePath(baseUrl.pathname);
  const prefix = normalizePath(options.prefix ?? basePath);

  const combos: Record<string, { os: string; arch: string; ext: string }> = {
    "linux-x64": { os: "linux", arch: "x64", ext: ".tar.gz" },
    "linux-arm64": { os: "linux", arch: "arm64", ext: ".tar.gz" },
    "darwin-x64": { os: "darwin", arch: "x64", ext: ".zip" },
    "darwin-arm64": { os: "darwin", arch: "arm64", ext: ".zip" },
    "windows-x64": { os: "windows", arch: "x64", ext: ".zip" },
  };

  const invalidTargets = options.targets.filter(
    (target) => !(target in combos),
  );
  if (invalidTargets.length > 0) {
    throw new Error(`Unknown targets: ${invalidTargets.join(", ")}`);
  }

  const uploads = options.targets.map((target) => {
    const { os, arch, ext } = combos[target];
    const filename = `${config.binName}-${os}-${arch}${ext}`;
    const localPath = join(options.dir, filename);
    return { filename, localPath };
  });

  if (!options.onlyLatest) {
    const missing: string[] = [];
    for (const upload of uploads) {
      const exists = await Bun.file(upload.localPath).exists();
      if (!exists) {
        missing.push(upload.localPath);
      }
    }

    if (missing.length > 0) {
      throw new Error(`Missing release artifacts:\n${missing.join("\n")}`);
    }
  }

  const uploadedUrls: string[] = [];
  if (!options.onlyLatest) {
    for (const upload of uploads) {
      const blobPath = [prefix, version, upload.filename]
        .filter(Boolean)
        .join("/");
      const result = await put(blobPath, Bun.file(upload.localPath), {
        access: "public",
        addRandomSuffix: false,
        contentType: contentTypeFor(upload.filename),
        token,
      });
      uploadedUrls.push(result.url);
    }
  }

  let latestResult: { url: string } | null = null;
  if (!options.skipLatest) {
    const latestPath = [prefix, "latest"].filter(Boolean).join("/");
    latestResult = await put(latestPath, `${version}\n`, {
      access: "public",
      addRandomSuffix: false,
      contentType: "text/plain; charset=utf-8",
      token,
    });
  }

  if (uploadedUrls.length > 0) {
    console.log("Uploaded release artifacts:");
    for (const url of uploadedUrls) {
      console.log(`- ${url}`);
    }
  }
  if (latestResult) {
    console.log(`Latest pointer: ${latestResult.url}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
