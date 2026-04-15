import { tool } from "ai";
import { z } from "zod";
import { getSandbox, shellEscape } from "./utils";

const TIMEOUT_MS = 30_000;
const MAX_BODY_LENGTH = 5_000;
const STATUS_PREFIX = "__OPEN_HARNESS_FETCH_STATUS__";
const LENGTH_PREFIX = "__OPEN_HARNESS_FETCH_LENGTH__";

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
- Body is truncated to 5000 characters to avoid overwhelming context

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

    const args: string[] = [
      "curl",
      "-sS",
      "-X",
      method,
      "--max-time",
      String(Math.ceil(TIMEOUT_MS / 1000)),
      "-o",
      '"$tmp"',
      "-w",
      shellEscape("%{http_code}"),
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

    const command = [
      "tmp=$(mktemp)",
      `status=$( ${args.join(" ")} )`,
      "exit_code=$?",
      'if [ "$exit_code" -ne 0 ]; then',
      '  rm -f "$tmp"',
      '  exit "$exit_code"',
      "fi",
      'body_length=$(wc -c < "$tmp")',
      `printf '%s%s\\n' ${shellEscape(STATUS_PREFIX)} "$status"`,
      `printf '%s%s\\n' ${shellEscape(LENGTH_PREFIX)} "$body_length"`,
      `head -c ${MAX_BODY_LENGTH} "$tmp"`,
      'rm -f "$tmp"',
    ].join("; ");

    try {
      const result = await sandbox.exec(command, workingDirectory, TIMEOUT_MS, {
        signal: abortSignal,
      });

      if (!result.success) {
        return {
          success: false,
          error: `Fetch failed: ${result.stderr || result.stdout || "Unknown error"}`,
        };
      }

      const output = result.stdout ?? "";
      const firstNewline = output.indexOf("\n");
      const secondNewline =
        firstNewline === -1 ? -1 : output.indexOf("\n", firstNewline + 1);
      const statusLine =
        firstNewline === -1 ? "" : output.slice(0, firstNewline);
      const lengthLine =
        firstNewline === -1 || secondNewline === -1
          ? ""
          : output.slice(firstNewline + 1, secondNewline);
      const parsedStatus = statusLine.startsWith(STATUS_PREFIX)
        ? Number.parseInt(statusLine.slice(STATUS_PREFIX.length), 10)
        : Number.NaN;
      const parsedLength = lengthLine.startsWith(LENGTH_PREFIX)
        ? Number.parseInt(lengthLine.slice(LENGTH_PREFIX.length), 10)
        : Number.NaN;
      const responseBody =
        secondNewline === -1 ? output : output.slice(secondNewline + 1);

      return {
        success: true,
        status: Number.isFinite(parsedStatus) ? parsedStatus : null,
        body: responseBody,
        truncated: Number.isFinite(parsedLength)
          ? parsedLength > MAX_BODY_LENGTH
          : result.truncated,
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
