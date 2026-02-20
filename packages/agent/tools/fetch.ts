import { tool } from "ai";
import { z } from "zod";

const fetchInputSchema = z.object({
  url: z.string().describe("The URL to fetch"),
  method: z
    .enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"])
    .optional()
    .describe("HTTP method. Default: GET"),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe("Optional HTTP headers as key-value pairs"),
  body: z
    .string()
    .optional()
    .describe("Optional request body (for POST/PUT/PATCH)"),
});

export const webFetchTool = tool({
  description: `Fetch a URL from the web.

USAGE:
- Make HTTP requests to external URLs
- Supports GET, POST, PUT, PATCH, DELETE, and HEAD methods
- Returns the response status, headers, and body text
- Body is truncated to 20000 characters to avoid overwhelming context

EXAMPLES:
- Simple GET: url: "https://api.example.com/data"
- POST with JSON: url: "https://api.example.com/items", method: "POST", headers: {"Content-Type": "application/json"}, body: "{\\"name\\":\\"item\\"}"`,
  inputSchema: fetchInputSchema,
  execute: async ({ url, method = "GET", headers, body }) => {
    try {
      const MAX_BODY_LENGTH = 20000;

      const init: RequestInit = {
        method,
        headers,
        signal: AbortSignal.timeout(30000),
      };
      if (method !== "GET" && method !== "HEAD" && body) {
        init.body = body;
      }
      const response = await fetch(url, init);

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      let responseBody: string;
      try {
        responseBody = await response.text();
      } catch {
        responseBody = "[Could not read response body]";
      }

      const truncated = responseBody.length > MAX_BODY_LENGTH;
      if (truncated) {
        responseBody = responseBody.slice(0, MAX_BODY_LENGTH);
      }

      return {
        success: true,
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: responseBody,
        truncated,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Fetch failed: ${message}`,
      };
    }
  },
});
