import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import type { ToolSet } from "ai";
import type { MCPConnection } from "@/lib/db/schema";
import {
  updateMCPConnectionTokens,
  updateMCPConnectionStatus,
} from "@/lib/db/mcp-connections";
import { resolveAuthHeaders, MCPAuthError } from "./auth";
import { getCatalogEntry } from "./catalog";
import { assertSafeUrl } from "./validate";

export interface ResolvedMCPTools {
  tools: ToolSet;
  clients: MCPClient[];
  connectionDescriptions: Array<{
    name: string;
    description: string;
    toolNames: string[];
  }>;
}

export async function resolveMCPTools(
  connections: MCPConnection[],
): Promise<ResolvedMCPTools> {
  const clients: MCPClient[] = [];
  const mergedTools: ToolSet = {};
  const connectionDescriptions: ResolvedMCPTools["connectionDescriptions"] = [];

  const results = await Promise.allSettled(
    connections.map(async (conn) => {
      // Skip connections that need re-authorization
      if (conn.status === "needs_auth") {
        console.warn(`Skipping MCP "${conn.name}": needs re-authorization`);
        return;
      }

      // Resolve auth headers (handles token refresh for OAuth)
      let headers: Record<string, string>;
      try {
        const auth = await resolveAuthHeaders(conn, async (tokenUpdate) => {
          await updateMCPConnectionTokens(conn.id, conn.userId, tokenUpdate);
        });
        headers = auth.headers;
      } catch (error) {
        if (error instanceof MCPAuthError) {
          await updateMCPConnectionStatus(
            conn.id,
            conn.userId,
            "needs_auth",
            error.message,
          );
        }
        throw error;
      }

      assertSafeUrl(conn.url);

      const client = await createMCPClient({
        transport: {
          type: conn.transportType as "http" | "sse",
          url: conn.url,
          headers,
        },
      });

      clients.push(client);
      const tools = await client.tools();

      const toolNames: string[] = [];
      for (const [toolName, tool] of Object.entries(tools)) {
        const prefix = conn.provider !== "custom" ? conn.provider : conn.id;
        const namespacedName = `mcp_${prefix}_${toolName}`;
        mergedTools[namespacedName] = tool as ToolSet[string];
        toolNames.push(namespacedName);
      }

      const catalogEntry = getCatalogEntry(conn.provider);
      connectionDescriptions.push({
        name: conn.name,
        description: catalogEntry?.description ?? "",
        toolNames,
      });
    }),
  );

  for (const result of results) {
    if (result.status === "rejected") {
      console.error("MCP connection failed:", result.reason);
    }
  }

  return { tools: mergedTools, clients, connectionDescriptions };
}

export async function closeMCPClients(clients: MCPClient[]): Promise<void> {
  await Promise.allSettled(clients.map((c) => c.close()));
}
