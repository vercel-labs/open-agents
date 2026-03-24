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

export type DevServerStopResponse = {
  stopped: boolean;
  packagePath: string;
  port: number;
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

type ConnectedSandbox = Awaited<ReturnType<typeof connectSandbox>>;

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

interface ResolvedDevServerTarget {
  packagePath: string;
  packageDir: string;
  packageDirAbs: string;
  port: number;
}

interface LaunchableDevServerTarget extends ResolvedDevServerTarget {
  candidate: DevServerCandidate;
}

interface PersistedDevServerTarget {
  packageDir: string;
  port: number;
}

const SUPPORTED_PORTS = new Set(DEFAULT_SANDBOX_PORTS);
const DEV_SERVER_PIDFILE_PREFIX = ".open-harness-dev-server";
const DEV_SERVER_STATE_FILENAME = `${DEV_SERVER_PIDFILE_PREFIX}-state.json`;
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

function resolvePackageDirAbs(
  workingDirectory: string,
  packageDir: string,
): string {
  return packageDir === "."
    ? workingDirectory
    : path.posix.join(workingDirectory, packageDir);
}

function buildResolvedDevServerTarget(params: {
  workingDirectory: string;
  packageDir: string;
  port: number;
}): ResolvedDevServerTarget {
  return {
    packagePath: formatPackagePath(params.packageDir),
    packageDir: params.packageDir,
    packageDirAbs: resolvePackageDirAbs(
      params.workingDirectory,
      params.packageDir,
    ),
    port: params.port,
  };
}

function toLaunchableDevServerTarget(
  sandbox: ConnectedSandbox,
  candidate: DevServerCandidate,
): LaunchableDevServerTarget {
  return {
    ...buildResolvedDevServerTarget({
      workingDirectory: sandbox.workingDirectory,
      packageDir: candidate.packageDir,
      port: candidate.port,
    }),
    candidate,
  };
}

function isValidPersistedPackageDir(packageDir: string): boolean {
  if (packageDir === ".") {
    return true;
  }

  if (packageDir.length === 0 || path.posix.isAbsolute(packageDir)) {
    return false;
  }

  const normalizedPackageDir = path.posix.normalize(packageDir);
  return (
    normalizedPackageDir === packageDir &&
    normalizedPackageDir !== "." &&
    normalizedPackageDir !== ".." &&
    !normalizedPackageDir.startsWith("../")
  );
}

function parsePersistedDevServerTarget(
  content: string,
): PersistedDevServerTarget | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    const packageDir =
      typeof parsed.packageDir === "string" ? parsed.packageDir : null;
    const port = toSupportedPort(
      typeof parsed.port === "number" && Number.isInteger(parsed.port)
        ? parsed.port
        : null,
    );

    if (
      !packageDir ||
      port === null ||
      !isValidPersistedPackageDir(packageDir)
    ) {
      return null;
    }

    return {
      packageDir,
      port,
    };
  } catch {
    return null;
  }
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
  sandbox: ConnectedSandbox,
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
  sandbox: ConnectedSandbox,
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

function getPackageManagerLockfiles(packageManager: PackageManager): string[] {
  return (
    PACKAGE_MANAGER_LOCKFILES.find((entry) => entry.manager === packageManager)
      ?.files ?? []
  );
}

async function getPathStat(sandbox: ConnectedSandbox, targetPath: string) {
  try {
    return await sandbox.stat(targetPath);
  } catch {
    return null;
  }
}

function getDependencyInputPaths(params: {
  packageDirAbs: string;
  installRootAbs: string;
  packageManager: PackageManager;
}): string[] {
  const dependencyInputPaths = new Set<string>();
  const ancestorDirectories = getAncestorDirectories(
    params.packageDirAbs,
    params.installRootAbs,
  );

  for (const directory of ancestorDirectories) {
    dependencyInputPaths.add(path.posix.join(directory, "package.json"));

    for (const lockfile of getPackageManagerLockfiles(params.packageManager)) {
      dependencyInputPaths.add(path.posix.join(directory, lockfile));
    }
  }

  return [...dependencyInputPaths];
}

async function shouldInstallDependencies(params: {
  sandbox: ConnectedSandbox;
  packageDirAbs: string;
  installRootAbs: string;
  packageManager: PackageManager;
}): Promise<boolean> {
  const nodeModulesStat = await getPathStat(
    params.sandbox,
    path.posix.join(params.installRootAbs, "node_modules"),
  );
  if (!nodeModulesStat?.isDirectory()) {
    return true;
  }

  for (const dependencyInputPath of getDependencyInputPaths(params)) {
    const dependencyInputStat = await getPathStat(
      params.sandbox,
      dependencyInputPath,
    );
    if (
      dependencyInputStat &&
      dependencyInputStat.mtimeMs > nodeModulesStat.mtimeMs
    ) {
      return true;
    }
  }

  return false;
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
  const extraArgs = getFrameworkArgs(framework, port).join(" ");

  switch (packageManager) {
    case "bun":
      return `env BROWSER=none HOST=0.0.0.0 PORT=${port} bun run dev${extraArgs ? ` -- ${extraArgs}` : ""}`;
    case "pnpm":
      return `env BROWSER=none HOST=0.0.0.0 PORT=${port} pnpm dev${extraArgs ? ` -- ${extraArgs}` : ""}`;
    case "yarn":
      return `env BROWSER=none HOST=0.0.0.0 PORT=${port} yarn dev${extraArgs ? ` ${extraArgs}` : ""}`;
    case "npm":
      return `env BROWSER=none HOST=0.0.0.0 PORT=${port} npm run dev${extraArgs ? ` -- ${extraArgs}` : ""}`;
  }
}

function getDevServerPidFilePath(packageDirAbs: string, port: number): string {
  return path.posix.join(
    packageDirAbs,
    `${DEV_SERVER_PIDFILE_PREFIX}-${port}.pid`,
  );
}

function buildLaunchCommand(params: {
  packageManager: PackageManager;
  framework: DevFramework;
  port: number;
  installRootAbs: string;
  packageDirAbs: string;
  installDependencies: boolean;
  pidFilePath: string;
}): string {
  const runCommand = buildRunCommand(
    params.packageManager,
    params.framework,
    params.port,
  );
  const commandSteps = [`printf '%s' "$$" > ${shellQuote(params.pidFilePath)}`];

  if (params.installDependencies) {
    const installCommand = INSTALL_COMMANDS[params.packageManager];
    commandSteps.push(
      params.installRootAbs === params.packageDirAbs
        ? installCommand
        : `(cd ${shellQuote(params.installRootAbs)} && ${installCommand})`,
    );
  }

  commandSteps.push(`exec ${runCommand}`);

  return commandSteps.join(" && ");
}

function getDevServerStateFilePath(workingDirectory: string): string {
  return path.posix.join(workingDirectory, DEV_SERVER_STATE_FILENAME);
}

function buildDevServerResponse(
  sandbox: ConnectedSandbox,
  target: Pick<ResolvedDevServerTarget, "packagePath" | "port">,
): DevServerLaunchResponse {
  if (!sandbox.domain) {
    throw new Error("Sandbox does not expose preview URLs");
  }

  return {
    packagePath: target.packagePath,
    port: target.port,
    url: sandbox.domain(target.port),
  };
}

async function clearPersistedDevServerTarget(
  sandbox: ConnectedSandbox,
): Promise<void> {
  await sandbox.exec(
    `rm -f ${shellQuote(getDevServerStateFilePath(sandbox.workingDirectory))}`,
    sandbox.workingDirectory,
    5_000,
  );
}

async function readPersistedDevServerTarget(
  sandbox: ConnectedSandbox,
): Promise<ResolvedDevServerTarget | null> {
  try {
    const persistedTarget = parsePersistedDevServerTarget(
      await sandbox.readFile(
        getDevServerStateFilePath(sandbox.workingDirectory),
        "utf-8",
      ),
    );
    if (!persistedTarget) {
      await clearPersistedDevServerTarget(sandbox);
      return null;
    }

    return buildResolvedDevServerTarget({
      workingDirectory: sandbox.workingDirectory,
      packageDir: persistedTarget.packageDir,
      port: persistedTarget.port,
    });
  } catch {
    return null;
  }
}

async function writePersistedDevServerTarget(
  sandbox: ConnectedSandbox,
  target: Pick<ResolvedDevServerTarget, "packageDir" | "port">,
): Promise<void> {
  await sandbox.writeFile(
    getDevServerStateFilePath(sandbox.workingDirectory),
    JSON.stringify({
      packageDir: target.packageDir,
      port: target.port,
    }),
    "utf-8",
  );
}

async function clearDevServerPidFile(
  sandbox: ConnectedSandbox,
  packageDirAbs: string,
  port: number,
): Promise<void> {
  const pidFilePath = getDevServerPidFilePath(packageDirAbs, port);
  await sandbox.exec(`rm -f ${shellQuote(pidFilePath)}`, packageDirAbs, 5_000);
}

async function getRunningDevServerPid(params: {
  sandbox: ConnectedSandbox;
  packageDirAbs: string;
  port: number;
}): Promise<string | null> {
  const { sandbox, packageDirAbs, port } = params;
  const pidFilePath = getDevServerPidFilePath(packageDirAbs, port);

  try {
    const pid = (await sandbox.readFile(pidFilePath, "utf-8")).trim();
    if (!/^[1-9][0-9]*$/.test(pid)) {
      await clearDevServerPidFile(sandbox, packageDirAbs, port);
      return null;
    }

    const checkResult = await sandbox.exec(
      `kill -0 ${pid}`,
      packageDirAbs,
      5_000,
    );
    if (!checkResult.success) {
      await clearDevServerPidFile(sandbox, packageDirAbs, port);
      return null;
    }

    return pid;
  } catch {
    return null;
  }
}

async function stopDevServer(params: {
  sandbox: ConnectedSandbox;
  packageDirAbs: string;
  port: number;
}): Promise<boolean> {
  const pid = await getRunningDevServerPid(params);
  if (!pid) {
    return false;
  }

  await params.sandbox.exec(
    `kill ${pid} 2>/dev/null || true`,
    params.packageDirAbs,
    5_000,
  );
  await clearDevServerPidFile(
    params.sandbox,
    params.packageDirAbs,
    params.port,
  );
  return true;
}

async function findDevServerCandidates(
  sandbox: ConnectedSandbox,
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

async function resolveDevServerTarget(
  sandbox: ConnectedSandbox,
): Promise<LaunchableDevServerTarget | null> {
  const candidate = pickBestCandidate(await findDevServerCandidates(sandbox));
  if (!candidate) {
    return null;
  }

  return toLaunchableDevServerTarget(sandbox, candidate);
}

async function connectDevServerSandboxForSession(
  sessionId: string,
  userId: string,
) {
  const sessionContext = await requireOwnedSessionWithSandboxGuard({
    userId,
    sessionId,
    sandboxGuard: isSandboxActive,
    sandboxErrorMessage: "Resume the sandbox before running a dev server",
    sandboxErrorStatus: 409,
  });
  if (!sessionContext.ok) {
    return sessionContext;
  }

  const sandboxState = sessionContext.sessionRecord.sandboxState;
  if (!sandboxState) {
    return {
      ok: false as const,
      response: Response.json(
        { error: "Resume the sandbox before running a dev server" },
        { status: 409 },
      ),
    };
  }

  const sandbox = await connectSandbox(sandboxState, {
    ports: DEFAULT_SANDBOX_PORTS,
  });

  return {
    ok: true as const,
    sandbox,
  };
}

export async function POST(_req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId } = await context.params;

  try {
    const sandboxResult = await connectDevServerSandboxForSession(
      sessionId,
      authResult.userId,
    );
    if (!sandboxResult.ok) {
      return sandboxResult.response;
    }

    const { sandbox } = sandboxResult;
    if (!sandbox.execDetached) {
      return Response.json(
        { error: "Sandbox does not support background commands" },
        { status: 500 },
      );
    }

    const persistedTarget = await readPersistedDevServerTarget(sandbox);
    if (persistedTarget) {
      const existingPersistedPid = await getRunningDevServerPid({
        sandbox,
        packageDirAbs: persistedTarget.packageDirAbs,
        port: persistedTarget.port,
      });
      if (existingPersistedPid) {
        return Response.json(buildDevServerResponse(sandbox, persistedTarget));
      }

      await clearPersistedDevServerTarget(sandbox);
    }

    const target = await resolveDevServerTarget(sandbox);
    if (!target) {
      return Response.json(
        { error: "No supported dev script found in package.json files" },
        { status: 404 },
      );
    }

    const { candidate, packageDirAbs, port } = target;
    const existingPid = await getRunningDevServerPid({
      sandbox,
      packageDirAbs,
      port,
    });
    if (existingPid) {
      await writePersistedDevServerTarget(sandbox, target);
      return Response.json(buildDevServerResponse(sandbox, target));
    }

    const { packageManager, installRootAbs } = await detectPackageManager(
      sandbox,
      packageDirAbs,
      candidate.packageManagerField,
    );
    const installDependencies = await shouldInstallDependencies({
      sandbox,
      installRootAbs,
      packageDirAbs,
      packageManager,
    });
    const launchCommand = buildLaunchCommand({
      packageManager,
      framework: candidate.framework,
      port,
      installRootAbs,
      packageDirAbs,
      installDependencies,
      pidFilePath: getDevServerPidFilePath(packageDirAbs, port),
    });

    try {
      await sandbox.execDetached(launchCommand, packageDirAbs);
    } catch (error) {
      await clearDevServerPidFile(sandbox, packageDirAbs, port).catch(
        () => undefined,
      );
      throw error;
    }

    await writePersistedDevServerTarget(sandbox, target);
    return Response.json(buildDevServerResponse(sandbox, target));
  } catch (error) {
    console.error("Failed to launch dev server:", error);
    return Response.json(
      { error: "Failed to launch dev server" },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId } = await context.params;

  try {
    const sandboxResult = await connectDevServerSandboxForSession(
      sessionId,
      authResult.userId,
    );
    if (!sandboxResult.ok) {
      return sandboxResult.response;
    }

    const { sandbox } = sandboxResult;
    const persistedTarget = await readPersistedDevServerTarget(sandbox);
    if (persistedTarget) {
      const stopped = await stopDevServer({
        sandbox,
        packageDirAbs: persistedTarget.packageDirAbs,
        port: persistedTarget.port,
      });
      await clearPersistedDevServerTarget(sandbox);

      if (stopped) {
        return Response.json({
          stopped,
          packagePath: persistedTarget.packagePath,
          port: persistedTarget.port,
        } satisfies DevServerStopResponse);
      }
    }

    const target = await resolveDevServerTarget(sandbox);
    if (!target) {
      return Response.json(
        { error: "No supported dev script found in package.json files" },
        { status: 404 },
      );
    }

    const stopped = await stopDevServer({
      sandbox,
      packageDirAbs: target.packageDirAbs,
      port: target.port,
    });
    if (stopped) {
      await clearPersistedDevServerTarget(sandbox);
    }

    return Response.json({
      stopped,
      packagePath: target.packagePath,
      port: target.port,
    } satisfies DevServerStopResponse);
  } catch (error) {
    console.error("Failed to stop dev server:", error);
    return Response.json(
      { error: "Failed to stop dev server" },
      { status: 500 },
    );
  }
}
