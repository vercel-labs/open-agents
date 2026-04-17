import { tool } from "ai";
import { z } from "zod";
import { getSandbox, shellEscape, toDisplayPath } from "./utils";

const TIMEOUT_MS = 30_000;
export const MAX_BODY_LENGTH = 10_000;
const FETCH_BODY_DIR = ".open-harness/web-fetch";

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

const fetchOutputSchema = z.union([
  z.object({
    success: z.literal(true),
    status: z.number().int().nullable(),
    body: z.string(),
    contentType: z.string().nullable(),
    bytes: z.number().int(),
    truncated: z.boolean(),
    savedBodyPath: z.string().nullable(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

export const webFetchTool = tool({
  description: `Fetch a URL from the web.

USAGE:
- Make HTTP requests to external URLs
- Supports GET, POST, PUT, PATCH, DELETE, and HEAD methods
- Returns the response status and body text
- Large response bodies are saved to a sandbox file while the tool returns a ${MAX_BODY_LENGTH}-character preview

EXAMPLES:
- Simple GET: url: "https://api.example.com/data"
- POST with JSON: url: "https://api.example.com/items", method: "POST", headers: {"Content-Type": "application/json"}, body: "{\\\\"name\\\\":\\\\"item\\\\"}"`,
  inputSchema: fetchInputSchema,
  outputSchema: fetchOutputSchema,
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
      `>(head -c ${MAX_BODY_LENGTH} >&3)`,
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
      `body_dir=${shellEscape(FETCH_BODY_DIR)}`,
      'mkdir -p "$body_dir"',
      'body_file=$(mktemp "$body_dir/body.XXXXXX")',
      'headers_file=$(mktemp "$body_dir/headers.XXXXXX")',
      `status=$(${args.join(" ")} -D "$headers_file" -o "$body_file")`,
      "curlExit=$?",
      'if [ "$curlExit" -ne 0 ]; then rm -f "$body_file" "$headers_file"; exit "$curlExit"; fi',
      String.raw`content_type=$(grep -i '^content-type:' "$headers_file" | tail -n 1 | sed 's/^[^:]*:[[:space:]]*//' | tr -d '\r')`,
      String.raw`bytes=$(wc -c < "$body_file" | tr -d '[:space:]')`,
      "truncated=false",
      'saved_body_path=""',
      String.raw`if [ "\${bytes:-0}" -gt ${MAX_BODY_LENGTH} ]; then`,
      "  truncated=true",
      '  saved_body_path=$(mktemp "$body_dir/fetch.XXXXXX.body")',
      '  mv "$body_file" "$saved_body_path"',
      `  preview_base64=$(head -c ${MAX_BODY_LENGTH} "$saved_body_path" | base64 | tr -d '\\n')`,
      "else",
      "  preview_base64=$(base64 < \"$body_file\" | tr -d '\\n')",
      '  rm -f "$body_file"',
      "fi",
      'rm -f "$headers_file"',
      `printf '%s\\n%s\\n%s\\n%s\\n%s\\n%s' "$preview_base64" "$status" "$content_type" "$bytes" "$truncated" "$saved_body_path"`,
      "exit $curlExit",
    ].join("\n");

    try {
      const result = await sandbox.exec(command, workingDirectory, TIMEOUT_MS, {
        signal: abortSignal,
      });

      if (result.exitCode !== 0) {
        return {
          success: false,
          error: `Fetch failed: ${result.stderr || result.stdout || "Unknown error"}`,
        };
      }

      const outputLines = (result.stdout ?? "").split("\n");
      const [
        previewBase64 = "",
        statusText = "",
        contentTypeText = "",
        bytesText = "0",
        truncatedText = "false",
        savedBodyPathText = "",
      ] = outputLines;
      const status = /^\d+$/.test(statusText) ? parseInt(statusText, 10) : null;
      const bytes = /^\d+$/.test(bytesText) ? parseInt(bytesText, 10) : 0;
      const responseBody = previewBase64
        ? Buffer.from(previewBase64, "base64").toString("utf-8")
        : "";
      const savedBodyPath = savedBodyPathText.trim()
        ? toDisplayPath(savedBodyPathText.trim(), workingDirectory)
        : null;

      return {
        success: true,
        status,
        body: responseBody,
        contentType: contentTypeText.trim() || null,
        bytes,
        truncated: truncatedText.trim() === "true",
        savedBodyPath,
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
