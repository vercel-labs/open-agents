import path from "node:path";
import { connectSandbox } from "@open-harness/sandbox";
import {
  requireAuthenticatedUser,
  requireOwnedSessionWithSandboxGuard,
} from "@/app/api/sessions/_lib/session-context";
import { DEFAULT_SANDBOX_PORTS } from "@/lib/sandbox/config";
import { isSandboxActive } from "@/lib/sandbox/utils";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export type DevServerLaunchResponse = {
  packagePath: string;
  port: number;
  url: string;
};

type PackageManager = "bun" | "pnpm" | "yarn" | "npm";
type DevFramework =
  | "next"
  | "vite"
  | "astro"
  | "react-scripts"
  | "remix"
  | "nuxt"
  | "custom";

interface PackageManifest {
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface DevServerCandidate {
  packagePath: string;
  packageDir: string;
  port: number;
  script: string;
  framework: DevFramework;
  score: number;
  packageManagerField?: string;
}

const SUPPORTED_PORTS = new Set(DEFAULT_SANDBOX_PORTS);
const INSTALL_COMMANDS: Record<PackageManager, string> = {
  bun: "bun install",
  pnpm: "pnpm install",
  yarn: "yarn install",
  npm: "npm install",
};
const PACKAGE_MANAGER_LOCKFILES: Array<{
  manager: PackageManager;
  files: string[];
}> = [
  { manager: "bun", files: ["bun.lockb", "bun.lock"] },
  { manager: "pnpm", files: ["pnpm-lock.yaml", "pnpm-workspace.yaml"] },
  { manager: "yarn", files: ["yarn.lock"] },
  { manager: "npm", files: ["package-lock.json"] },
];
const PACKAGE_JSON_FIND_COMMAND =
  "find . \\( -path '*/node_modules/*' -o -path '*/.git/*' -o -path '*/.next/*' -o -path '*/dist/*' -o -path '*/build/*' -o -path '*/coverage/*' -o -path '*/.turbo/*' \\) -prune -o -name package.json -print | sort";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function parseManifest(content: string): PackageManifest | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    return {
      packageManager:
        typeof parsed.packageManager === "string"
          ? parsed.packageManager
          : undefined,
      scripts: toStringRecord(parsed.scripts),
      dependencies: toStringRecord(parsed.dependencies),
      devDependencies: toStringRecord(parsed.devDependencies),
    };
  } catch {
    return null;
  }
}

function normalizePackageJsonPath(packageJsonPath: string): string {
  return packageJsonPath.replace(/^\.\//, "");
}

function normalizePackageDir(packageJsonPath: string): string {
  const packageDir = path.posix.dirname(packageJsonPath);
  return packageDir === "." ? "." : packageDir;
}

function formatPackagePath(packageDir: string): string {
  return packageDir === "." ? "root" : packageDir;
}

function extractExplicitPort(script: string): number | null {
  const patterns = [
    /--port(?:=|\s+)(\d{2,5})/i,
    /(?:^|\s)-p(?:=|\s+)(\d{2,5})(?=$|\s)/i,
    /\bPORT=(\d{2,5})\b/i,
  ];

  for (const pattern of patterns) {
    const match = script.match(pattern);
    if (!match?.[1]) {
      continue;
    }

    const parsed = Number.parseInt(match[1], 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

function getDependencyNames(manifest: PackageManifest): Set<string> {
  return new Set<string>([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ]);
}

function detectFramework(
  manifest: PackageManifest,
  script: string,
): DevFramework {
  const normalizedScript = script.toLowerCase();
  const dependencyNames = getDependencyNames(manifest);

  if (normalizedScript.includes("next dev") || dependencyNames.has("next")) {
    return "next";
  }

  if (normalizedScript.includes("astro") || dependencyNames.has("astro")) {
    return "astro";
  }

  if (
    normalizedScript.includes("vite") ||
    dependencyNames.has("vite") ||
    dependencyNames.has("@sveltejs/kit")
  ) {
    return "vite";
  }

  if (
    normalizedScript.includes("react-scripts") ||
    dependencyNames.has("react-scripts")
  ) {
    return "react-scripts";
  }

  if (
    normalizedScript.includes("remix") ||
    dependencyNames.has("@remix-run/dev")
  ) {
    return "remix";
  }

  if (normalizedScript.includes("nuxt") || dependencyNames.has("nuxt")) {
    return "nuxt";
  }

  return "custom";
}

function getDefaultPortForFramework(framework: DevFramework): number | null {
  switch (framework) {
    case "next":
    case "react-scripts":
    case "remix":
    case "nuxt":
      return 3000;
    case "vite":
      return 5173;
    case "astro":
      return 4321;
    default:
      return null;
  }
}

function toSupportedPort(port: number | null | undefined): number | null {
  if (typeof port !== "number") {
    return null;
  }

  return SUPPORTED_PORTS.has(port) ? port : null;
}

function isWorkspaceOrchestratorScript(script: string): boolean {
  const normalized = script.toLowerCase();
  const patterns = [
    "turbo",
    " nx ",
    "nx ",
    "lerna",
    "concurrently",
    "npm-run-all",
    "wireit",
    "yarn workspaces",
    "pnpm -r",
    "pnpm --recursive",
    "npm -w",
    "npm --workspace",
  ];

  return patterns.some((pattern) => normalized.includes(pattern));
}

function scoreCandidate(candidate: {
  packageDir: string;
  framework: DevFramework;
  port: number;
  script: string;
}): number {
  let score = 0;

  if (candidate.framework !== "custom") {
    score += 100;
  }

  if (SUPPORTED_PORTS.has(candidate.port)) {
    score += 60;
  }

  if (candidate.packageDir.startsWith("apps/")) {
    score += 30;
  }

  if (candidate.packageDir.startsWith("app/")) {
    score += 20;
  }

  if (isWorkspaceOrchestratorScript(candidate.script)) {
    score -= 120;
  }

  if (candidate.packageDir === ".") {
    score -= 10;
  }

  return score - candidate.packageDir.split("/").length;
}

function buildCandidate(
  manifest: PackageManifest,
  packageJsonPath: string,
): DevServerCandidate | null {
  const script = manifest.scripts?.dev?.trim();
  if (!script) {
    return null;
  }

  const framework = detectFramework(manifest, script);
  const explicitPort = toSupportedPort(extractExplicitPort(script));
  const frameworkPort = toSupportedPort(getDefaultPortForFramework(framework));
  const port = explicitPort ?? frameworkPort;
  if (port === null) {
    return null;
  }

  const packageDir = normalizePackageDir(packageJsonPath);

  return {
    packagePath: formatPackagePath(packageDir),
    packageDir,
    port,
    script,
    framework,
    score: scoreCandidate({
      packageDir,
      framework,
      port,
      script,
    }),
    packageManagerField: manifest.packageManager,
  };
}

function pickBestCandidate(
  candidates: DevServerCandidate[],
): DevServerCandidate | null {
  const [candidate] = [...candidates].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    return left.packageDir.localeCompare(right.packageDir);
  });

  return candidate ?? null;
}

async function pathExists(
  sandbox: Awaited<ReturnType<typeof connectSandbox>>,
  targetPath: string,
): Promise<boolean> {
  try {
    await sandbox.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function getAncestorDirectories(startDir: string, stopDir: string): string[] {
  const directories: string[] = [];
  let currentDir = startDir;

  while (true) {
    directories.push(currentDir);

    if (currentDir === stopDir) {
      break;
    }

    const nextDir = path.posix.dirname(currentDir);
    if (nextDir === currentDir) {
      break;
    }

    currentDir = nextDir;
  }

  return directories;
}

function parsePackageManagerName(
  packageManagerField: string | undefined,
): PackageManager | null {
  if (!packageManagerField) {
    return null;
  }

  const [packageManagerName] = packageManagerField.split("@");
  switch (packageManagerName) {
    case "bun":
    case "pnpm":
    case "yarn":
    case "npm":
      return packageManagerName;
    default:
      return null;
  }
}

async function detectPackageManager(
  sandbox: Awaited<ReturnType<typeof connectSandbox>>,
  packageDirAbs: string,
  packageManagerField: string | undefined,
): Promise<{ packageManager: PackageManager; installRootAbs: string }> {
  const ancestorDirectories = getAncestorDirectories(
    packageDirAbs,
    sandbox.workingDirectory,
  );

  for (const directory of ancestorDirectories) {
    for (const entry of PACKAGE_MANAGER_LOCKFILES) {
      for (const lockfile of entry.files) {
        if (await pathExists(sandbox, path.posix.join(directory, lockfile))) {
          return {
            packageManager: entry.manager,
            installRootAbs: directory,
          };
        }
      }
    }
  }

  for (const directory of ancestorDirectories) {
    const packageJsonPath = path.posix.join(directory, "package.json");
    if (!(await pathExists(sandbox, packageJsonPath))) {
      continue;
    }

    const manifest = parseManifest(
      await sandbox.readFile(packageJsonPath, "utf-8"),
    );
    const packageManager = parsePackageManagerName(manifest?.packageManager);
    if (packageManager) {
      return {
        packageManager,
        installRootAbs: directory,
      };
    }
  }

  return {
    packageManager: parsePackageManagerName(packageManagerField) ?? "npm",
    installRootAbs: packageDirAbs,
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function getFrameworkArgs(framework: DevFramework, port: number): string[] {
  switch (framework) {
    case "next":
      return ["--hostname", "0.0.0.0", "--port", String(port)];
    case "vite":
    case "astro":
    case "nuxt":
      return ["--host", "0.0.0.0", "--port", String(port)];
    default:
      return [];
  }
}

function buildRunCommand(
  packageManager: PackageManager,
  framework: DevFramework,
  port: number,
): string {
  const envPrefix = `BROWSER=none HOST=0.0.0.0 PORT=${port}`;
  const extraArgs = getFrameworkArgs(framework, port).join(" ");

  switch (packageManager) {
    case "bun":
      return `${envPrefix} bun run dev${extraArgs ? ` -- ${extraArgs}` : ""}`;
    case "pnpm":
      return `${envPrefix} pnpm dev${extraArgs ? ` -- ${extraArgs}` : ""}`;
    case "yarn":
      return `${envPrefix} yarn dev${extraArgs ? ` ${extraArgs}` : ""}`;
    case "npm":
      return `${envPrefix} npm run dev${extraArgs ? ` -- ${extraArgs}` : ""}`;
  }
}

function buildLaunchCommand(params: {
  packageManager: PackageManager;
  framework: DevFramework;
  port: number;
  installRootAbs: string;
  packageDirAbs: string;
  installDependencies: boolean;
}): string {
  const runCommand = buildRunCommand(
    params.packageManager,
    params.framework,
    params.port,
  );

  if (!params.installDependencies) {
    return runCommand;
  }

  const installCommand = INSTALL_COMMANDS[params.packageManager];
  if (params.installRootAbs === params.packageDirAbs) {
    return `${installCommand} && ${runCommand}`;
  }

  return `(cd ${shellQuote(params.installRootAbs)} && ${installCommand}) && ${runCommand}`;
}

async function findDevServerCandidates(
  sandbox: Awaited<ReturnType<typeof connectSandbox>>,
): Promise<DevServerCandidate[]> {
  const result = await sandbox.exec(
    PACKAGE_JSON_FIND_COMMAND,
    sandbox.workingDirectory,
    30_000,
  );

  if (!result.success) {
    throw new Error(result.stderr || "Failed to search for package.json files");
  }

  const packageJsonPaths = result.stdout
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => normalizePackageJsonPath(entry))
    .slice(0, 100);

  const candidates = await Promise.all(
    packageJsonPaths.map(async (packageJsonPath) => {
      try {
        const absolutePath = path.posix.join(
          sandbox.workingDirectory,
          packageJsonPath,
        );
        const manifest = parseManifest(
          await sandbox.readFile(absolutePath, "utf-8"),
        );
        if (!manifest) {
          return null;
        }

        return buildCandidate(manifest, packageJsonPath);
      } catch {
        return null;
      }
    }),
  );

  return candidates.filter(
    (candidate): candidate is DevServerCandidate => candidate !== null,
  );
}

export async function POST(_req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId } = await context.params;
  const sessionContext = await requireOwnedSessionWithSandboxGuard({
    userId: authResult.userId,
    sessionId,
    sandboxGuard: isSandboxActive,
    sandboxErrorMessage: "Resume the sandbox before running a dev server",
    sandboxErrorStatus: 409,
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const { sessionRecord } = sessionContext;
  const sandboxState = sessionRecord.sandboxState;
  if (!sandboxState) {
    return Response.json(
      { error: "Resume the sandbox before running a dev server" },
      { status: 409 },
    );
  }

  try {
    const sandbox = await connectSandbox(sandboxState, {
      ports: DEFAULT_SANDBOX_PORTS,
    });

    if (!sandbox.execDetached) {
      return Response.json(
        { error: "Sandbox does not support background commands" },
        { status: 500 },
      );
    }

    if (!sandbox.domain) {
      return Response.json(
        { error: "Sandbox does not expose preview URLs" },
        { status: 500 },
      );
    }

    const candidate = pickBestCandidate(await findDevServerCandidates(sandbox));
    if (!candidate) {
      return Response.json(
        { error: "No supported dev script found in package.json files" },
        { status: 404 },
      );
    }

    const packageDirAbs =
      candidate.packageDir === "."
        ? sandbox.workingDirectory
        : path.posix.join(sandbox.workingDirectory, candidate.packageDir);
    const { packageManager, installRootAbs } = await detectPackageManager(
      sandbox,
      packageDirAbs,
      candidate.packageManagerField,
    );
    const installDependencies = !(await pathExists(
      sandbox,
      path.posix.join(installRootAbs, "node_modules"),
    ));
    const launchCommand = buildLaunchCommand({
      packageManager,
      framework: candidate.framework,
      port: candidate.port,
      installRootAbs,
      packageDirAbs,
      installDependencies,
    });

    await sandbox.execDetached(launchCommand, packageDirAbs);

    return Response.json({
      packagePath: candidate.packagePath,
      port: candidate.port,
      url: sandbox.domain(candidate.port),
    } satisfies DevServerLaunchResponse);
  } catch (error) {
    console.error("Failed to launch dev server:", error);
    return Response.json(
      { error: "Failed to launch dev server" },
      { status: 500 },
    );
  }
}
