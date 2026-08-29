/**
 * Run one Codex harness-runner turn against an existing caller-owned Open
 * Agents sandbox. This validates bridge startup, AI Gateway auth, AI SDK UI
 * stream conversion, and bridge cleanup without routing through the chat
 * workflow.
 *
 * Usage:
 *   pnpm harness:smoke:codex -- --sandbox session_<session-id>
 *   pnpm harness:smoke:codex -- --sandbox session_<session-id> --prompt "Reply with the current working directory."
 */

import { randomUUID } from "node:crypto";
import {
  ensureGatewayApiKeyEnv,
  runHarnessTurn,
} from "@open-agents/harness-runner";
import { connectVercelSandbox } from "@open-agents/sandbox/vercel";
import { DEFAULT_SANDBOX_PORTS } from "../apps/web/lib/sandbox/config.ts";
import { requireOptionValue, runMain } from "./lib/cli.ts";

const DEFAULT_PROMPT =
  "Reply with exactly: codex harness smoke ok. Do not call tools.";

interface CliOptions {
  sandboxName: string;
  prompt: string;
  model?: string;
}

function printUsage() {
  console.log(`Usage:
  pnpm harness:smoke:codex -- --sandbox session_<session-id>
  pnpm harness:smoke:codex -- --sandbox session_<session-id> --prompt "Reply with the current working directory."

Options:
  --sandbox <name>   Existing caller-owned Open Agents sandbox name
  --prompt <text>    Prompt for the Codex turn
  --model <id>       Optional Codex model override
  --help             Show this message`);
}

function parseArgs(argv: string[]): CliOptions | { help: true } {
  let sandboxName: string | undefined;
  let prompt = DEFAULT_PROMPT;
  let model: string | undefined;

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
    if (arg === "--prompt") {
      prompt = requireOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--model") {
      model = requireOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!sandboxName) {
    throw new Error(
      "Pass --sandbox <name> for an existing Open Agents sandbox.",
    );
  }

  return { sandboxName, prompt, model };
}

/**
 * Resolve Codex auth for this run and return the AI Gateway credential to
 * broker to the sandbox, if any. Brokering is opt-in per connect (see
 * `buildDefaultCredentialBrokeringPolicy` in `packages/sandbox`), so this
 * mirrors the harness runner route: pass the key the turn authenticates with,
 * and nothing when Codex talks to OpenAI directly.
 */
async function resolveCodexAuth(): Promise<string | undefined> {
  const configuredGatewayKey =
    process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (configuredGatewayKey) {
    return configuredGatewayKey;
  }
  if (process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY) {
    return undefined;
  }

  const gatewayKey = await ensureGatewayApiKeyEnv();
  if (!gatewayKey) {
    throw new Error(
      "Codex auth is unavailable. Set AI_GATEWAY_API_KEY, VERCEL_OIDC_TOKEN, CODEX_API_KEY, or OPENAI_API_KEY.",
    );
  }
  return gatewayKey;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if ("help" in parsed) {
    printUsage();
    return;
  }

  const aiGatewayApiKey = await resolveCodexAuth();

  const sandbox = await connectVercelSandbox({
    sandboxName: parsed.sandboxName,
    resume: true,
    ports: DEFAULT_SANDBOX_PORTS,
    ...(aiGatewayApiKey ? { aiGatewayApiKey } : {}),
  });
  const sessionId = `codex-smoke-${randomUUID()}`;
  const messageId = `assistant-${randomUUID()}`;
  const chunks: Array<{ type: string; [key: string]: unknown }> = [];
  const modelId = parsed.model
    ? `openai/${parsed.model.replace(/^openai\//, "")}`
    : "openai/gpt-5.4";
  const result = await runHarnessTurn({
    harnessId: "codex",
    sandboxProvider: sandbox.toHarnessSandboxProvider([5001]),
    workingDirectory: sandbox.workingDirectory,
    sessionId,
    messageId,
    messages: [
      {
        id: `user-${randomUUID()}`,
        role: "user",
        parts: [{ type: "text", text: parsed.prompt }],
      },
    ],
    originalMessages: [],
    selectedModelId: modelId,
    modelId,
    onChunk: (chunk) => {
      chunks.push(chunk);
    },
  });
  const text = result.responseMessage.parts
    .filter(
      (part): part is { type: "text"; text: string } =>
        part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("");
  const output = {
    ok: result.finishReason !== "error",
    sandboxName: parsed.sandboxName,
    sessionId,
    finishReason: result.finishReason,
    rawFinishReason: result.rawFinishReason,
    text,
    chunkTypes: chunks.map((chunk) => chunk.type),
    responseMessage: result.responseMessage,
  };

  console.log(JSON.stringify(output, null, 2));

  if (result.finishReason === "error") {
    throw new Error(result.rawFinishReason ?? "Codex harness turn failed.");
  }
}

runMain(main);
