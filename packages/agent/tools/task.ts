import {
  type LanguageModelUsage,
  type ModelMessage,
  tool,
  type UIToolInvocation,
} from "ai";
import { z } from "zod";
import { executorSubagent } from "../subagents/executor";
import { explorerSubagent } from "../subagents/explorer";
import { screencastSubagent } from "../subagents/screencast";
import { sumLanguageModelUsage } from "../usage";
import { getSandboxContext, getSubagentModel } from "./utils";

const subagentTypeSchema = z.enum(["explorer", "executor", "screencast"]);

const taskInputSchema = z.object({
  subagentType: subagentTypeSchema.describe(
    "Type of subagent: 'explorer' for read-only research, 'executor' for implementation tasks, 'screencast' for recording narrated browser demos",
  ),
  task: z
    .string()
    .describe("Short description of the task (displayed to user)"),
  instructions: z.string().describe(
    `Detailed instructions for the subagent. Include:
- Goal and deliverables
- Step-by-step procedure
- Constraints and patterns to follow
- How to verify the work`,
  ),
});

const taskPendingToolCallSchema = z.object({
  name: z.string(),
  input: z.unknown(),
});

export type TaskPendingToolCall = z.infer<typeof taskPendingToolCallSchema>;

export const taskOutputSchema = z.object({
  pending: taskPendingToolCallSchema.optional(),
  toolCallCount: z.number().int().nonnegative().optional(),
  startedAt: z.number().int().nonnegative().optional(),
  modelId: z.string().optional(),
  final: z.custom<ModelMessage[]>().optional(),
  usage: z.custom<LanguageModelUsage>().optional(),
});

export type TaskToolOutput = z.infer<typeof taskOutputSchema>;

export const taskTool = tool({
  description: `Launch a specialized subagent to handle complex tasks autonomously.

SUBAGENT TYPES:

1. **explorer** (READ-ONLY)
   - Use for: Finding files, searching code, answering questions about the codebase
   - Tools: read, grep, glob, bash (read-only commands only)
   - CANNOT create, modify, or delete files
   - Best for: Research, codebase exploration, finding implementations

2. **executor** (FULL ACCESS)
   - Use for: Implementation tasks that require creating or modifying files
   - Tools: read, write, edit, grep, glob, bash
   - CAN create, modify, and delete files
   - Best for: Feature scaffolding, refactors, migrations, code generation

3. **screencast** (RECORDING)
   - Use for: Recording narrated browser demos with TTS voiceover
   - Tools: bash (agent-browser + ffmpeg), synthesize_voiceover, upload_blob
   - Records a browser session, generates speech from narration script, muxes audio, uploads to Vercel Blob
   - Returns: public blob URL + PR-embeddable markdown with transcript
   - Best for: Feature demos, visual walkthroughs, PR screencasts

WHEN TO USE EXPLORER:
- "Where is X implemented?"
- "Find all usages of Y"
- "How does Z work in this codebase?"
- Gathering context before making changes

WHEN TO USE EXECUTOR:
- Feature scaffolding that touches multiple files
- Cross-layer refactors requiring coordinated changes
- Mass migrations or boilerplate generation
- Any implementation task where detailed execution would clutter the main conversation

WHEN TO USE SCREENCAST:
- Recording a narrated browser demo of a feature
- Creating visual documentation or walkthroughs
- Producing a shareable video for a PR or design review
- The screencast subagent handles the full pipeline: record → TTS voiceover → mux audio → upload

WHEN NOT TO USE (do it yourself):
- Simple, single-file or single-change edits
- Tasks where you already have all the context you need

BEHAVIOR:
- Subagents work AUTONOMOUSLY without asking follow-up questions
- They run up to 30 tool steps and then return
- They return ONLY a concise summary - their internal steps are isolated from the parent

HOW TO USE:
- Choose the appropriate subagentType based on whether you need read-only or write access
- Provide a short task string (for display) summarizing the goal
- Provide detailed instructions including goals, steps, constraints, and verification criteria

IMPORTANT:
- Be explicit and concrete - subagents cannot ask clarifying questions
- Include critical context (APIs, function names, file paths) in the instructions
- The parent agent will not see the subagent's internal tool calls, only its final summary

NOTE: All subagents run within the sandbox. Use explorer for read-only research, executor for implementation work, and screencast for recording narrated browser demos.`,
  inputSchema: taskInputSchema,
  outputSchema: taskOutputSchema,
  execute: async function* (
    { subagentType, task, instructions },
    { experimental_context, abortSignal },
  ) {
    const sandboxContext = getSandboxContext(experimental_context, "task");
    const model = getSubagentModel(experimental_context, "task");
    const subagentModelId = typeof model === "string" ? model : model.modelId;

    const subagent =
      subagentType === "explorer"
        ? explorerSubagent
        : subagentType === "screencast"
          ? screencastSubagent
          : executorSubagent;

    const result = await subagent.stream({
      prompt:
        "Complete this task and provide a summary of what you accomplished.",
      options: {
        task,
        instructions,
        sandbox: sandboxContext.sandbox,
        model,
      },
      abortSignal,
    });

    const startedAt = Date.now();
    let toolCallCount = 0;
    let pending: TaskPendingToolCall | undefined;
    let usage: LanguageModelUsage | undefined;

    // Emit an initial state so UIs can show elapsed time from a stable timestamp.
    yield { toolCallCount, startedAt, modelId: subagentModelId };

    for await (const part of result.fullStream) {
      if (part.type === "tool-call") {
        toolCallCount += 1;
        pending = { name: part.toolName, input: part.input };
        yield {
          pending,
          toolCallCount,
          usage,
          startedAt,
          modelId: subagentModelId,
        };
      }

      if (part.type === "finish-step") {
        usage = sumLanguageModelUsage(usage, part.usage);
        // Keep the last observed tool call in interim updates so task UIs don't
        // flicker back to an initializing state between subagent steps.
        yield {
          pending,
          toolCallCount,
          usage,
          startedAt,
          modelId: subagentModelId,
        };
      }
    }

    const response = await result.response;
    const finalUsage = usage ?? (await result.usage);
    yield {
      final: response.messages,
      toolCallCount,
      usage: finalUsage,
      startedAt,
      modelId: subagentModelId,
    };
  },
  toModelOutput: ({ output: { final: messages } }) => {
    if (!messages) {
      return { type: "text", value: "Task completed." };
    }

    // Search assistant messages in reverse for any with text content.
    // The model often includes text alongside tool calls, so the last
    // assistant message may only have tool-call parts with no text.
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg?.role !== "assistant") continue;
      const content = msg.content;
      if (!content) continue;

      if (typeof content === "string" && content.trim()) {
        return { type: "text", value: content };
      }

      if (Array.isArray(content)) {
        const textPart = content.findLast((p) => p.type === "text");
        if (textPart && "text" in textPart && textPart.text.trim()) {
          return { type: "text", value: textPart.text };
        }
      }
    }

    // Last resort: scan tool results for URLs (e.g., from upload_blob)
    const urls: string[] = [];
    for (const msg of messages) {
      if (msg.role !== "tool") continue;
      const parts = Array.isArray(msg.content) ? msg.content : [];
      for (const part of parts) {
        if (part.type === "tool-result") {
          const output = part.output as Record<string, unknown> | undefined;
          if (output && typeof output.url === "string") {
            urls.push(output.url);
          }
        }
      }
    }

    if (urls.length > 0) {
      return {
        type: "text",
        value: `Task completed.\n\n${urls.map((u) => u).join("\n")}`,
      };
    }

    return { type: "text", value: "Task completed." };
  },
});

export type TaskToolUIPart = UIToolInvocation<typeof taskTool>;
