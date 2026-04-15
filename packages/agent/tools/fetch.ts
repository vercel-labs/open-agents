import { tool } from "ai";
import { z } from "zod";
import { getSandbox, shellEscape } from "./utils";

const TIMEOUT_MS = 30_000;
const MAX_BODY_LENGTH = 5_000;

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
    truncated: z.boolean(),
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
- Body is truncated to 5000 characters to avoid overwhelming context

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

    const requestPayload = JSON.stringify({
      url,
      method,
      headers,
      body,
      maxBodyLength: MAX_BODY_LENGTH,
      timeoutMs: TIMEOUT_MS,
    });

    const script = `
const input = JSON.parse(process.argv[1]);
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

(async () => {
  try {
    const response = await fetch(input.url, {
      method: input.method,
      headers: input.headers,
      body:
        input.method === "GET" || input.method === "HEAD"
          ? undefined
          : input.body,
      redirect: "manual",
      signal: controller.signal,
    });

    const reader = response.body?.getReader();
    const chunks = [];
    let capturedBytes = 0;
    let totalBytes = 0;
    let truncated = false;

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        totalBytes += value.byteLength;

        const remaining = input.maxBodyLength - capturedBytes;
        if (remaining > 0) {
          const slice = value.subarray(0, remaining);
          if (slice.byteLength > 0) {
            chunks.push(Buffer.from(slice));
            capturedBytes += slice.byteLength;
          }
        }

        if (totalBytes > input.maxBodyLength) {
          truncated = true;
          await reader.cancel();
          break;
        }
      }
    }

    const body = Buffer.concat(chunks).toString("utf8");
    process.stdout.write(
      JSON.stringify({
        success: true,
        status: Number.isInteger(response.status) ? response.status : null,
        body,
        truncated,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(
      JSON.stringify({
        success: false,
        error: \`Fetch failed: \${message}\`,
      }),
    );
  } finally {
    clearTimeout(timeout);
  }
})();`;

    try {
      const result = await sandbox.exec(
        `node -e ${shellEscape(script)} ${shellEscape(requestPayload)}`,
        workingDirectory,
        TIMEOUT_MS,
        { signal: abortSignal },
      );

      if (!result.success) {
        return {
          success: false,
          error: `Fetch failed: ${result.stderr || result.stdout || "Unknown error"}`,
        };
      }

      const rawOutput = result.stdout.trim();
      const parsedOutput = fetchOutputSchema.safeParse(JSON.parse(rawOutput));

      if (!parsedOutput.success) {
        return {
          success: false,
          error: "Fetch failed: Sandbox returned an invalid response.",
        };
      }

      return parsedOutput.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Fetch failed: ${message}`,
      };
    }
  },
});
