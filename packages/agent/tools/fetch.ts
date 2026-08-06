import { tool } from "ai";
import { z } from "zod";
import { getSandbox, shellEscape, toDisplayPath } from "./utils";

const TIMEOUT_MS = 30_000;
export const MAX_BODY_LENGTH = 10_000;
const FETCH_BODY_DIR = ".open-harness/web-fetch";

type Ipv4Address = [number, number, number, number];
type Ipv6Address = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

function normalizeHostname(hostname: string): string {
  const lowerHostname = hostname.toLowerCase();

  if (lowerHostname.startsWith("[") && lowerHostname.endsWith("]")) {
    return lowerHostname.slice(1, -1);
  }

  return lowerHostname;
}

function parseIpv4Address(hostname: string): Ipv4Address | null {
  const octets = hostname.split(".");

  if (octets.length !== 4) {
    return null;
  }

  const parsed: number[] = [];

  for (const octet of octets) {
    if (!/^\d+$/.test(octet)) {
      return null;
    }

    const value = Number(octet);
    if (value < 0 || value > 255) {
      return null;
    }

    parsed.push(value);
  }

  return [parsed[0] ?? 0, parsed[1] ?? 0, parsed[2] ?? 0, parsed[3] ?? 0];
}

function parseIpv6Address(hostname: string): Ipv6Address | null {
  const [head = "", tail = "", ...extra] = hostname.split("::");

  if (extra.length > 0) {
    return null;
  }

  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const missingParts = hostname.includes("::")
    ? 8 - headParts.length - tailParts.length
    : 0;

  if (missingParts < 0) {
    return null;
  }

  const parts = [
    ...headParts,
    ...Array.from({ length: missingParts }, () => "0"),
    ...tailParts,
  ];

  if (parts.length !== 8) {
    return null;
  }

  const parsed: number[] = [];

  for (const part of parts) {
    if (!/^[\da-f]{1,4}$/i.test(part)) {
      return null;
    }

    parsed.push(Number.parseInt(part, 16));
  }

  return [
    parsed[0] ?? 0,
    parsed[1] ?? 0,
    parsed[2] ?? 0,
    parsed[3] ?? 0,
    parsed[4] ?? 0,
    parsed[5] ?? 0,
    parsed[6] ?? 0,
    parsed[7] ?? 0,
  ];
}

function isPrivateIpv4Address(hostname: string): boolean {
  const octets = parseIpv4Address(hostname);

  if (!octets) {
    return false;
  }

  const [first, second] = octets;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function getIpv4MappedIpv6Address(groups: Ipv6Address): string | null {
  const isMappedIpv4 =
    groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;

  if (!isMappedIpv4) {
    return null;
  }

  return [
    groups[6] >> 8,
    groups[6] & 0xff,
    groups[7] >> 8,
    groups[7] & 0xff,
  ].join(".");
}

function isPrivateIpv6Address(hostname: string): boolean {
  const groups = parseIpv6Address(hostname);

  if (!groups) {
    return false;
  }

  const ipv4MappedAddress = getIpv4MappedIpv6Address(groups);

  if (ipv4MappedAddress) {
    return isPrivateIpv4Address(ipv4MappedAddress);
  }

  const isUnspecified = groups.every((group) => group === 0);
  const isLoopback =
    groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
  const isUniqueLocal = (groups[0] & 0xfe00) === 0xfc00;
  const isLinkLocal = (groups[0] & 0xffc0) === 0xfe80;

  return isUnspecified || isLoopback || isUniqueLocal || isLinkLocal;
}

function isPrivateHost(hostname: string): boolean {
  const normalizedHostname = normalizeHostname(hostname);

  return (
    normalizedHostname === "localhost" ||
    isPrivateIpv4Address(normalizedHostname) ||
    isPrivateIpv6Address(normalizedHostname)
  );
}

export function isAllowedWebUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }

  return !isPrivateHost(parsed.hostname);
}

async function resolvesToPrivateHost(params: {
  hostname: string;
  sandbox: Awaited<ReturnType<typeof getSandbox>>;
  workingDirectory: string;
  abortSignal?: AbortSignal;
}): Promise<boolean> {
  if (isPrivateHost(params.hostname)) {
    return true;
  }

  const result = await params.sandbox.exec(
    `getent ahosts ${shellEscape(params.hostname)} | awk '{print $1}' | sort -u`,
    params.workingDirectory,
    5000,
    { signal: params.abortSignal },
  );

  if (!result.success) {
    return true;
  }

  return result.stdout
    .split("\n")
    .map((address) => address.trim())
    .filter(Boolean)
    .some(isPrivateHost);
}

const fetchInputSchema = z.object({
  url: z
    .string()
    .url({ protocol: /^https?$/ })
    .refine(isAllowedWebUrl, "URL must use http(s) and a public host")
    .describe("The URL to fetch"),
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
  needsApproval: true,
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

    const parsedUrl = new URL(url);
    if (
      await resolvesToPrivateHost({
        hostname: parsedUrl.hostname,
        sandbox,
        workingDirectory,
        abortSignal,
      })
    ) {
      return {
        success: false,
        error: "Fetch failed: URL resolves to a private or internal host",
      };
    }

    const args: string[] = [
      "curl",
      "-sS",
      "--proto",
      shellEscape("=http,https"),
      "--proto-redir",
      shellEscape("=http,https"),
      "-X",
      method,
      "--max-time",
      String(Math.ceil(TIMEOUT_MS / 1000)),
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
