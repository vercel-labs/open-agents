import { createVercelSandbox } from "@ai-sdk/sandbox-vercel";
import type { Sandbox as VercelSandboxSDK } from "@vercel/sandbox";
import type { Sandbox } from "../interface.ts";

export const HARNESS_WORKING_DIRECTORY = "/tmp/open-agents-harness";

export type AiSdkHarnessSandboxProvider = ReturnType<
  typeof createVercelSandbox
>;

type AiSdkHarnessSandboxSession = Awaited<
  ReturnType<AiSdkHarnessSandboxProvider["createSession"]>
>;

/**
 * A sandbox that can host an AI SDK harness session. Consumers that need the
 * capability should require this type instead of duck-typing the method.
 */
export type HarnessCapableSandbox = Sandbox & {
  toHarnessSandboxProvider(
    bridgePorts?: ReadonlyArray<number>,
  ): AiSdkHarnessSandboxProvider;
};

/**
 * Wrap a harness sandbox session so its default working directory points at
 * the dedicated harness base directory instead of the repository workspace.
 *
 * Every member of the session interface is forwarded explicitly; methods are
 * invoked on the original session so their internal state stays intact.
 */
function withHarnessWorkingDirectory(
  session: AiSdkHarnessSandboxSession,
): AiSdkHarnessSandboxSession {
  const destroy = session.destroy;
  const setNetworkPolicy = session.setNetworkPolicy;
  const setPorts = session.setPorts;

  return {
    id: session.id,
    defaultWorkingDirectory: HARNESS_WORKING_DIRECTORY,
    ports: session.ports,
    description: session.description,
    getPortUrl: (options) => session.getPortUrl(options),
    stop: () => session.stop(),
    ...(destroy ? { destroy: () => destroy.call(session) } : {}),
    ...(setNetworkPolicy
      ? { setNetworkPolicy: (policy) => setNetworkPolicy.call(session, policy) }
      : {}),
    ...(setPorts
      ? { setPorts: (ports, options) => setPorts.call(session, ports, options) }
      : {}),
    restricted: () => session.restricted(),
    readFile: (options) => session.readFile(options),
    readBinaryFile: (options) => session.readBinaryFile(options),
    readTextFile: (options) => session.readTextFile(options),
    writeFile: (options) => session.writeFile(options),
    writeBinaryFile: (options) => session.writeBinaryFile(options),
    writeTextFile: (options) => session.writeTextFile(options),
    spawn: (options) => session.spawn(options),
    run: (options) => session.run(options),
  };
}

/**
 * The harness base directory does not exist on a fresh sandbox. Create it
 * before the session is handed out: the AI SDK harness resolves bootstrap
 * paths against the default working directory and runs commands with it as
 * the cwd, which fails with "chdir: no such file or directory" otherwise.
 */
async function ensureHarnessWorkingDirectory(
  session: AiSdkHarnessSandboxSession,
  abortSignal?: AbortSignal,
): Promise<void> {
  const result = await session.run({
    command: `mkdir -p ${HARNESS_WORKING_DIRECTORY}`,
    ...(abortSignal ? { abortSignal } : {}),
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to create harness working directory ${HARNESS_WORKING_DIRECTORY}: ${result.stderr || result.stdout}`,
    );
  }
}

/**
 * Adapt a caller-owned @vercel/sandbox SDK instance for AI SDK harnesses.
 * The returned provider never stops or deletes the underlying VM.
 */
export function createHarnessSandboxProvider(
  sdk: VercelSandboxSDK,
  bridgePorts: ReadonlyArray<number> = [],
): AiSdkHarnessSandboxProvider {
  const provider = createVercelSandbox({
    sandbox: sdk,
    ...(bridgePorts.length > 0 ? { bridgePorts } : {}),
  });
  const resumeSession = provider.resumeSession;

  return {
    specificationVersion: provider.specificationVersion,
    providerId: provider.providerId,
    bridgePorts: provider.bridgePorts,
    createSession: async (options) => {
      const session = await provider.createSession(options);
      await ensureHarnessWorkingDirectory(session, options?.abortSignal);
      return withHarnessWorkingDirectory(session);
    },
    ...(resumeSession
      ? {
          resumeSession: async (options) => {
            const session = await resumeSession(options);
            await ensureHarnessWorkingDirectory(session, options?.abortSignal);
            return withHarnessWorkingDirectory(session);
          },
        }
      : {}),
  };
}
