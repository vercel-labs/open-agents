import { resolve } from "node:path";
import type { ExecResult } from "../interface";
import { connectVercelSandbox } from "../vercel";
import type { VercelSandbox } from "../vercel/sandbox";

type Step =
  | { type: "command"; value: string }
  | { type: "script"; value: string };

interface CliOptions {
  baseSnapshotId: string;
  steps: Step[];
  env: Record<string, string>;
  timeoutMs: number;
  workingDirectory?: string;
  json: boolean;
}

interface Logger {
  info(message: string): void;
  warn(message: string): void;
}

function usage(): void {
  console.log(`Usage:
  bun run --cwd packages/sandbox snapshot:bootstrap -- --base-snapshot-id <snapshot-id> (--command <cmd> | --script <path>) [options]

Options:
  --base-snapshot-id, --snapshot-id  Base snapshot ID to boot from (required)
  -c, --command                      Command to run inside the sandbox (repeatable)
  -s, --script                       Local shell script to upload and run inside the sandbox (repeatable)
      --env                          Environment variable in KEY=VALUE form (repeatable)
      --timeout                      Sandbox and per-step timeout in milliseconds (default: 300000)
      --cwd                          Working directory inside the sandbox (defaults to sandbox working directory)
      --json                         Print the final result as JSON
  -h, --help                         Show this help message

Examples:
  bun run --cwd packages/sandbox snapshot:bootstrap -- --base-snapshot-id snap_base_123 --command "apt-get update" --command "apt-get install -y ffmpeg"
  bun run --cwd packages/sandbox snapshot:bootstrap -- --base-snapshot-id snap_base_123 --script ./scripts/install-playwright.sh
`);
}

function readRequiredValue(
  argv: string[],
  index: number,
  flag: string,
): { value: string; nextIndex: number } {
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }
  return { value, nextIndex: index + 1 };
}

function parseEnvAssignment(assignment: string): {
  key: string;
  value: string;
} {
  const separatorIndex = assignment.indexOf("=");
  if (separatorIndex <= 0) {
    throw new Error(
      `Invalid --env value '${assignment}'. Expected KEY=VALUE format.`,
    );
  }

  return {
    key: assignment.slice(0, separatorIndex),
    value: assignment.slice(separatorIndex + 1),
  };
}

function parseTimeout(rawValue: string): number {
  const timeoutMs = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      `Invalid timeout '${rawValue}'. Expected a positive integer.`,
    );
  }
  return timeoutMs;
}

function parseArgs(argv: string[]): CliOptions {
  let baseSnapshotId: string | undefined;
  const steps: Step[] = [];
  const env: Record<string, string> = {};
  let timeoutMs = 300_000;
  let workingDirectory: string | undefined;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "-h":
      case "--help":
        usage();
        process.exit(0);
      case "--base-snapshot-id":
      case "--snapshot-id": {
        const parsed = readRequiredValue(argv, index, arg);
        baseSnapshotId = parsed.value;
        index = parsed.nextIndex;
        break;
      }
      case "-c":
      case "--command": {
        const parsed = readRequiredValue(argv, index, arg);
        steps.push({ type: "command", value: parsed.value });
        index = parsed.nextIndex;
        break;
      }
      case "-s":
      case "--script": {
        const parsed = readRequiredValue(argv, index, arg);
        steps.push({ type: "script", value: parsed.value });
        index = parsed.nextIndex;
        break;
      }
      case "--env": {
        const parsed = readRequiredValue(argv, index, arg);
        const assignment = parseEnvAssignment(parsed.value);
        env[assignment.key] = assignment.value;
        index = parsed.nextIndex;
        break;
      }
      case "--timeout": {
        const parsed = readRequiredValue(argv, index, arg);
        timeoutMs = parseTimeout(parsed.value);
        index = parsed.nextIndex;
        break;
      }
      case "--cwd": {
        const parsed = readRequiredValue(argv, index, arg);
        workingDirectory = parsed.value;
        index = parsed.nextIndex;
        break;
      }
      case "--json":
        json = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!baseSnapshotId) {
    throw new Error("--base-snapshot-id is required");
  }

  if (steps.length === 0) {
    throw new Error("Provide at least one --command or --script step");
  }

  return {
    baseSnapshotId,
    steps,
    env,
    timeoutMs,
    workingDirectory,
    json,
  };
}

function createLogger(json: boolean): Logger {
  return {
    info(message: string) {
      if (json) {
        console.error(message);
        return;
      }
      console.log(message);
    },
    warn(message: string) {
      console.error(message);
    },
  };
}

function describeStep(step: Step, stepNumber?: number): string {
  if (step.type === "command") {
    return stepNumber === undefined ? "command" : `command ${stepNumber}`;
  }

  const scriptPath = resolve(step.value);
  return stepNumber === undefined
    ? `script ${scriptPath}`
    : `script ${stepNumber} (${scriptPath})`;
}

function formatExecFailure(label: string, result: ExecResult): string {
  const details = [result.stderr.trim(), result.stdout.trim()]
    .filter((value) => value.length > 0)
    .join("\n");
  const exitCodePart =
    result.exitCode === null ? "" : ` with exit code ${result.exitCode}`;

  return details
    ? `Failed to run ${label}${exitCodePart}:\n${details}`
    : `Failed to run ${label}${exitCodePart}`;
}

async function runExecStep(
  sandbox: VercelSandbox,
  label: string,
  command: string,
  cwd: string,
  timeoutMs: number,
  logger: Logger,
): Promise<void> {
  logger.info(`Running ${label}`);

  const result = await sandbox.exec(command, cwd, timeoutMs);
  if (!result.success) {
    throw new Error(formatExecFailure(label, result));
  }

  if (result.stdout.trim().length > 0) {
    logger.info(result.stdout.trimEnd());
  }

  if (result.truncated) {
    logger.warn(`Output for ${label} was truncated to 50000 characters.`);
  }
}

async function runScriptStep(
  sandbox: VercelSandbox,
  localPath: string,
  cwd: string,
  timeoutMs: number,
  logger: Logger,
  stepNumber: number,
): Promise<void> {
  const resolvedPath = resolve(localPath);
  const file = Bun.file(resolvedPath);
  if (!(await file.exists())) {
    throw new Error(`Script file not found: ${resolvedPath}`);
  }

  const remotePath = `/tmp/open-harness-bootstrap-snapshot-${stepNumber}.sh`;
  await sandbox.writeFile(remotePath, await file.text(), "utf-8");

  try {
    await runExecStep(
      sandbox,
      `script ${resolvedPath}`,
      `bash "${remotePath}"`,
      cwd,
      timeoutMs,
      logger,
    );
  } finally {
    await sandbox
      .exec(`rm -f "${remotePath}"`, cwd, 10_000)
      .catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(Bun.argv.slice(2));
  const logger = createLogger(options.json);

  let sandbox: VercelSandbox | undefined;
  let snapshotCreated = false;

  try {
    logger.info(
      `Creating sandbox from base snapshot ${options.baseSnapshotId}...`,
    );

    sandbox = await connectVercelSandbox({
      baseSnapshotId: options.baseSnapshotId,
      env: Object.keys(options.env).length > 0 ? options.env : undefined,
      timeout: options.timeoutMs,
    });

    const workingDirectory =
      options.workingDirectory ?? sandbox.workingDirectory;
    logger.info(`Sandbox ready: ${sandbox.id}`);
    logger.info(`Working directory: ${workingDirectory}`);

    for (const [index, step] of options.steps.entries()) {
      const stepNumber = index + 1;
      const stepLabel = `step ${stepNumber}/${options.steps.length} (${describeStep(step, stepNumber)})`;
      if (step.type === "command") {
        await runExecStep(
          sandbox,
          stepLabel,
          step.value,
          workingDirectory,
          options.timeoutMs,
          logger,
        );
        continue;
      }

      await runScriptStep(
        sandbox,
        step.value,
        workingDirectory,
        options.timeoutMs,
        logger,
        stepNumber,
      );
    }

    logger.info("Creating snapshot...");
    const snapshot = await sandbox.snapshot();
    snapshotCreated = true;

    const result = {
      baseSnapshotId: options.baseSnapshotId,
      sandboxId: sandbox.id,
      snapshotId: snapshot.snapshotId,
      stepCount: options.steps.length,
    };

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      logger.info(`New snapshot created: ${snapshot.snapshotId}`);
      logger.info(JSON.stringify(result, null, 2));
    }
  } finally {
    if (sandbox && !snapshotCreated) {
      try {
        await sandbox.stop();
      } catch (error) {
        logger.warn(
          `Failed to stop sandbox ${sandbox.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : `Unknown error: ${String(error)}`,
  );
  process.exit(1);
});
