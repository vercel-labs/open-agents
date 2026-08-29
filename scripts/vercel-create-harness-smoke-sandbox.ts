/**
 * Create a persistent caller-owned sandbox for direct harness smoke tests.
 *
 * When a prepared deployment template or explicit base snapshot is available,
 * creation uses it directly. Otherwise this script performs the combined
 * external harness runtime preparation once before returning.
 *
 * Usage:
 *   pnpm harness:smoke:sandbox:create
 *   pnpm harness:smoke:sandbox:create -- --sandbox session_smoke-local
 *   pnpm harness:smoke:sandbox:create -- --from snap_123
 */

import { randomUUID } from "node:crypto";
import { prepareHarnessSandboxRuntimeProfile } from "@open-agents/harness-runner";
import { connectVercelSandbox } from "@open-agents/sandbox/vercel";
import { resolveSandboxBaseSnapshotId } from "../apps/web/lib/sandbox/base-snapshot.ts";
import {
  DEFAULT_SANDBOX_PORTS,
  DEFAULT_SANDBOX_TIMEOUT_MS,
  DEFAULT_SANDBOX_VCPUS,
} from "../apps/web/lib/sandbox/config.ts";
import { requireOptionValue, runMain } from "./lib/cli.ts";

interface CliOptions {
  sandboxName: string;
  baseSnapshotId?: string;
}

interface HelpResult {
  help: true;
}

function printUsage() {
  console.log(`Usage:
  pnpm harness:smoke:sandbox:create
  pnpm harness:smoke:sandbox:create -- --sandbox session_smoke-local
  pnpm harness:smoke:sandbox:create -- --from snap_123

Options:
  --sandbox <name>      Persistent sandbox name (default: generated)
  --from <snapshot-id>  Prepared base snapshot override
  --help                Show this message

The sandbox remains active after creation. Run the printed Codex smoke command
to attach the harness and execute one turn.`);
}

function parseArgs(argv: string[]): CliOptions | HelpResult {
  let sandboxName = `session_smoke-${randomUUID()}`;
  let baseSnapshotId: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }

    if (arg === "--sandbox") {
      sandboxName = requireOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--from") {
      baseSnapshotId = requireOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { sandboxName, baseSnapshotId };
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if ("help" in parsed) {
    printUsage();
    return;
  }

  const baseSnapshotId =
    parsed.baseSnapshotId ?? (await resolveSandboxBaseSnapshotId());
  const shouldPrepareRuntimeProfile = !baseSnapshotId;

  console.log(`Creating persistent sandbox ${parsed.sandboxName}.`);
  if (baseSnapshotId) {
    console.log(`Using prepared base snapshot ${baseSnapshotId}.`);
  } else {
    console.log(
      "No prepared base snapshot resolved. Runtime profile setup will run once after creation.",
    );
  }

  const sandbox = await connectVercelSandbox({
    name: parsed.sandboxName,
    timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
    vcpus: DEFAULT_SANDBOX_VCPUS,
    ports: DEFAULT_SANDBOX_PORTS,
    persistent: true,
    ...(baseSnapshotId ? { baseSnapshotId } : {}),
  });

  try {
    if (shouldPrepareRuntimeProfile) {
      console.log("Preparing external harness runtime profile.");
      await prepareHarnessSandboxRuntimeProfile(sandbox);
    }

    console.log("");
    console.log(`Sandbox ready: ${sandbox.name}`);
    console.log(`Run: pnpm harness:smoke:codex -- --sandbox ${sandbox.name}`);
  } catch (error) {
    try {
      await sandbox.stop();
    } catch (stopError) {
      console.error(
        `Failed to stop sandbox after setup error: ${
          stopError instanceof Error ? stopError.message : String(stopError)
        }`,
      );
    }

    throw error;
  }
}

runMain(main);
