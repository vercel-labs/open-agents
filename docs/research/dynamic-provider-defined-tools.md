## Types of Tools

The AI SDK supports three types of tools, each with different trade-offs:

### Custom Tools

Custom tools are tools you define entirely yourself, including the description, input schema, and execute function. They are provider-agnostic and give you full control.

```ts
import { tool } from "ai";
import { z } from "zod";

const weatherTool = tool({
  description: "Get the weather in a location",
  inputSchema: z.object({
    location: z.string().describe("The location to get the weather for"),
  }),
  execute: async ({ location }) => {
    // Your implementation
    return { temperature: 72, conditions: "sunny" };
  },
});
```

**When to use**: When you need full control, want provider portability, or are implementing application-specific functionality.

### Provider-Defined Tools

Provider-defined tools are tools where the provider specifies the tool's `inputSchema` and `description`, but you provide the `execute` function. These are sometimes called "client tools" because execution happens on your side.

Examples include Anthropic's `bash` and `text_editor` tools. The model has been specifically trained to use these tools effectively, which can result in better performance for supported tasks.

```ts
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

const result = await generateText({
  model: anthropic("claude-opus-4-5"),
  tools: {
    bash: anthropic.tools.bash_20250124({
      execute: async ({ command }) => {
        // Your implementation to run the command
        return runCommand(command);
      },
    }),
  },
  prompt: "List files in the current directory",
});
```

**When to use**: When the provider offers a tool the model is trained to use well, and you want better performance for that specific task.

### Provider-Executed Tools

Provider-executed tools are tools that run entirely on the provider's servers. You configure them, but the provider handles execution. These are sometimes called "server-side tools".

Examples include OpenAI's web search and Anthropic's code execution. These provide out-of-the-box functionality without requiring you to set up infrastructure.

```ts
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";

const result = await generateText({
  model: openai("gpt-5.2"),
  tools: {
    web_search: openai.tools.webSearch(),
  },
  prompt: "What happened in the news today?",
});
```

**When to use**: When you want powerful functionality (like web search or sandboxed code execution) without managing the infrastructure yourself.

---

Important to note that provider-defined tools include needs approval (which includes context too!).

e.g.

```ts
      bash: anthropic.tools.bash_20241022({
        needsApproval: ({command, restart}, {experimental_context}) => true,
        async execute({ command }, {experimental_context}) {
          console.log('COMMAND', command);
          return [
            {
              type: 'text',
              text: `
          ❯ ls
          README.md     build         data          node_modules  package.json  src           tsconfig.json
          `,
            },
          ];
        },
      }),
```

There's a needsApproval utility function in tools/utils.ts that can be used like this:

```ts
const bashInputSchema = z.object({
  command: z.string().describe("The bash command to execute"),
  cwd: z
    .string()
    .optional()
    .describe("Working directory for the command (absolute path)"),
});

type BashInput = z.infer<typeof bashInputSchema>;
type ApprovalFn = ToolNeedsApprovalFunction<BashInput>;
```

---

## Dynamic toolset per request concept

What if we could switch out specific tools for their provider-defined version, depending on whichever model is being used per request?

The following code is an example of this and this works.

```ts
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, LanguageModel, stepCountIs, tool } from "ai";
import { run } from "../lib/run";
import { z } from "zod";

const bashDefault = tool({
  description: "Execute bash commands",
  inputSchema: z.object({
    command: z.string().describe("The bash command to execute"),
  }),
  execute: async ({ command }) => {
    console.log("COMMAND", command);
    console.log("Using default bash tool execution");
    return [
      {
        type: "text",
        text: `
          ❯ ls
          README.md     build         data          node_modules  package.json  src           tsconfig.json
          `,
      },
    ];
  },
});

const bashAnthropic = anthropic.tools.bash_20250124({
  async execute({ command }) {
    console.log("COMMAND", command);
    console.log("Using Anthropic's bash tool execution");
    return [
      {
        type: "text",
        text: `
          ❯ ls
          README.md     build         data          node_modules  package.json  src           tsconfig.json
          `,
      },
    ];
  },
});

type Provider = "anthropic" | "openai" | "other";

function getModel(model: LanguageModel): Provider {
  if (typeof model === "string") {
    if (model.includes("anthropic") || model.includes("claude")) {
      return "anthropic";
    }
    return "other";
  }

  if (
    model.provider === "anthropic" ||
    model.provider.includes("anthropic") ||
    model.modelId.includes("anthropic") ||
    model.modelId.includes("claude")
  ) {
    return "anthropic";
  }

  return "other";
}

const bashTool = (model: LanguageModel) => {
  const provider = getModel(model);

  switch (provider) {
    case "anthropic":
      return bashAnthropic;
    default:
      return bashDefault;
  }
};

run(async () => {
  const model = anthropic("claude-haiku-4-5");
  const result = await generateText({
    model,
    tools: {
      bash: bashTool(model),
    },
    prompt: "List the files in my home directory.",
    stopWhen: stepCountIs(2),
  });

  console.log(result.text);
});
```
