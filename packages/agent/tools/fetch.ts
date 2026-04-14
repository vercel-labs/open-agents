import { tool } from "ai";
import { z } from "zod";
import { getSandbox, shellEscape } from "./utils";

const TIMEOUT_MS = 30_000;
const MAX_BODY_LENGTH = 20_000;

const fetchInputSchema = z.object({
  url: z.string().url().describe("The URL to fetch"),
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
- Returns the response status and body text
- Body is truncated to 20000 characters to avoid overwhelming context

EXAMPLES:
- Simple GET: url: "https://api.example.com/data"
- POST with JSON: url: "https://api.example.com/items", method: "POST", headers: {"Content-Type": "application/json"}, body: "{\\\\"name\\\\":\\\\"item\\\\"}"`,
  inputSchema: fetchInputSchema,
  execute: async (
    { url, method = "GET", headers, body },
    { experimental_context, abortSignal },
  ) => {
    const sandbox = await getSandbox(experimental_context, "web_fetch");
    const workingDirectory = sandbox.workingDirectory;

    // Build curl command to run inside the sandbox VM.
    // -sS: silent but show errors, -w: append HTTP status code after body
    const args: string[] = [
      "curl",
      "-sS",
      "-X",
      method,
      "--max-time",
      String(Math.ceil(TIMEOUT_MS / 1000)),
      "-w",
      shellEscape("\n%{http_code}"),
    ];

    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        args.push("-H", shellEscape(`${key}: ${value}`));
      }
    }

    if (method !== "GET" && method !== "HEAD" && body) {
      args.push("-d", shellEscape(body));
    }

    args.push(shellEscape(url));

    try {
      const result = await sandbox.exec(
        args.join(" "),
        workingDirectory,
        TIMEOUT_MS,
        { signal: abortSignal },
      );

      if (!result.success) {
        return {
          success: false,
          error: `Fetch failed: ${result.stderr || "Unknown error"}`,
        };
      }

      // curl -w '\n%{http_code}' appends the status code on the last line
      const output = result.stdout ?? "";
      const lastNewline = output.lastIndexOf("\n");
      const statusCode =
        lastNewline !== -1 ? parseInt(output.slice(lastNewline + 1), 10) : null;
      let responseBody =
        lastNewline !== -1 ? output.slice(0, lastNewline) : output;

      const truncated = responseBody.length > MAX_BODY_LENGTH;
      if (truncated) {
        responseBody = responseBody.slice(0, MAX_BODY_LENGTH);
      }

      return {
        success: true,
        status: statusCode,
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
