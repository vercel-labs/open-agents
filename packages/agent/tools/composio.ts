import {
  BaseNonAgenticProvider,
  Composio,
  type Tool,
  type ToolListParams,
} from "@composio/core";
import { tool } from "ai";
import { z } from "zod";
import { getUserId } from "./utils";

const MAX_DESCRIPTION_LENGTH = 300;
const MAX_EXECUTION_DATA_LENGTH = 20_000;
const MISSING_API_KEY_ERROR =
  "COMPOSIO_API_KEY is not configured. Composio integration is disabled.";
const MISSING_USER_ID_ERROR =
  "No user ID available. The Composio tool requires an authenticated user.";

const composioInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("search"),
    query: z
      .string()
      .min(1)
      .describe("Natural-language query describing the tool you need"),
    toolkits: z
      .array(z.string().regex(/^[a-z0-9-]+$/))
      .optional()
      .describe(
        'Optional toolkit slugs to narrow the search, for example ["gmail", "slack"]',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(30)
      .optional()
      .describe("Maximum number of search results to return. Default: 10"),
  }),
  z.object({
    action: z.literal("execute"),
    slug: z
      .string()
      .min(1)
      .describe(
        "Exact Composio tool slug to execute, for example GMAIL_SEND_EMAIL",
      ),
    arguments: z
      .record(z.string(), z.unknown())
      .describe("Arguments to pass to the Composio tool"),
  }),
]);

type ComposioInput = z.infer<typeof composioInputSchema>;

interface ComposioSearchResult {
  slug: string;
  name: string;
  description: string;
  toolkit: string;
}

class ComposioSearchProvider extends BaseNonAgenticProvider<
  ComposioSearchResult[],
  ComposioSearchResult
> {
  readonly name = "OpenHarnessComposioSearchProvider";

  wrapTool(toolDefinition: Tool): ComposioSearchResult {
    return {
      slug: toolDefinition.slug,
      name: toolDefinition.name,
      description: truncateText(
        toolDefinition.description ?? "",
        MAX_DESCRIPTION_LENGTH,
      ),
      toolkit: toolDefinition.toolkit?.slug ?? "unknown",
    };
  }

  wrapTools(toolDefinitions: Tool[]): ComposioSearchResult[] {
    return toolDefinitions.map((toolDefinition) =>
      this.wrapTool(toolDefinition),
    );
  }
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createSearchClient():
  | { composio: Composio<ComposioSearchProvider> }
  | { error: string } {
  const apiKey = process.env.COMPOSIO_API_KEY;

  if (!apiKey) {
    return { error: MISSING_API_KEY_ERROR };
  }

  return {
    composio: new Composio({
      apiKey,
      provider: new ComposioSearchProvider(),
    }),
  };
}

function createExecuteClient(): { composio: Composio } | { error: string } {
  const apiKey = process.env.COMPOSIO_API_KEY;

  if (!apiKey) {
    return { error: MISSING_API_KEY_ERROR };
  }

  return {
    composio: new Composio({
      apiKey,
    }),
  };
}

function truncateExecutionData(
  data: Record<string, unknown>,
): Record<string, unknown> | string {
  let stringifiedData: string;

  try {
    stringifiedData = JSON.stringify(data);
  } catch {
    return "[unserializable Composio response data]";
  }

  if (stringifiedData.length <= MAX_EXECUTION_DATA_LENGTH) {
    return data;
  }

  return truncateText(stringifiedData, MAX_EXECUTION_DATA_LENGTH);
}

export const composioTool = tool({
  needsApproval: (input: ComposioInput) => input.action === "execute",
  description: `Search for and execute Composio tools for external apps such as gmail, slack, linear, notion, and github.

ACTION: search
- Finds relevant Composio tool slugs for a natural-language request
- Example: action: "search", query: "find the Gmail send email tool", toolkits: ["gmail"]

ACTION: execute
- Runs a specific Composio tool by slug with arguments
- Example: action: "execute", slug: "GMAIL_SEND_EMAIL", arguments: {"to":"user@example.com","subject":"Hello","body":"Hi"}

IMPORTANT:
- This tool requires COMPOSIO_API_KEY on the server. If you get the "Composio integration is disabled" error, tell the user to set it and stop trying to use this tool for the rest of the turn.
- The user must have already connected the relevant account through Composio for this app's project.
- If execution fails with an auth/connection error, tell the user the toolkit isn't connected yet and point them at dashboard.composio.dev to connect it (or the app's in-app connect flow if available).`,
  inputSchema: composioInputSchema,
  execute: async (input, { experimental_context }) => {
    const userId = getUserId(experimental_context, "composio");

    if (!userId) {
      return {
        success: false,
        error: MISSING_USER_ID_ERROR,
      };
    }

    if (input.action === "search") {
      const clientResult = createSearchClient();

      if ("error" in clientResult) {
        return {
          success: false,
          error: clientResult.error,
        };
      }

      try {
        const filters = {
          search: input.query,
          limit: input.limit ?? 10,
          ...(input.toolkits ? { toolkits: input.toolkits } : {}),
        } as unknown as ToolListParams;

        return await clientResult.composio.tools.get(userId, filters);
      } catch (error) {
        return {
          success: false,
          error: `Composio search failed: ${getErrorMessage(error)}`,
        };
      }
    }

    const clientResult = createExecuteClient();

    if ("error" in clientResult) {
      return {
        success: false,
        successful: false,
        data: {},
        error: clientResult.error,
      };
    }

    try {
      const result = await clientResult.composio.tools.execute(input.slug, {
        userId,
        arguments: input.arguments,
        dangerouslySkipVersionCheck: true,
      });

      return {
        successful: result.successful,
        data: truncateExecutionData(result.data),
        error: result.error,
      };
    } catch (error) {
      const toolkit = input.slug.split("_")[0]?.toLowerCase() ?? "unknown";
      return {
        success: false,
        successful: false,
        data: {},
        error: `Composio execution failed for ${input.slug}: ${getErrorMessage(error)}. If this is an auth error, the user likely hasn't connected the "${toolkit}" toolkit yet — point them at their Composio dashboard to connect it.`,
      };
    }
  },
});
