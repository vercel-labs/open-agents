export type MCPAuthType = "none" | "bearer" | "headers" | "oauth";

export interface MCPCatalogEntry {
  provider: string;
  name: string;
  description: string;
  url: string;
  transportType: "http" | "sse";
  icon: string;
  authType: MCPAuthType;
}

export const MCP_CATALOG: MCPCatalogEntry[] = [
  {
    provider: "notion",
    name: "Notion",
    description: "Search pages, read content, create and update documents",
    url: "https://mcp.notion.com/mcp",
    transportType: "http",
    icon: "notion",
    authType: "oauth",
  },
  {
    provider: "granola",
    name: "Granola",
    description: "Access meeting notes, transcripts, and action items",
    url: "https://mcp.granola.ai/mcp",
    transportType: "http",
    icon: "granola",
    authType: "oauth",
  },
];

export function getCatalogEntry(provider: string): MCPCatalogEntry | undefined {
  return MCP_CATALOG.find((entry) => entry.provider === provider);
}
