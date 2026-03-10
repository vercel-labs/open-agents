import { consumeReadable, FileWriter } from "./file-writer";
import {
  isRecord,
  normalizePath,
  parseCommandEnvelope,
  parseInteger,
  parseLogLine,
  VercelApiError,
  type VercelCommandData,
  type VercelCommandLogLine,
} from "./rest-shared";

const DEFAULT_VERCEL_API_BASE_URL = "https://vercel.com/api";
const USER_AGENT = `open-harness/sandbox (${process.platform}; ${process.arch}; Node.js/${process.version})`;

export type { VercelAuthContext } from "./rest-shared";
export {
  getVercelAuthContextFromOidcToken,
  isSandboxUnavailableError,
  VercelApiError,
} from "./rest-shared";
export class VercelRestClient {
  private token: string;
  private teamId?: string;
  private readonly baseUrl: string;

  constructor(config: {
    token: string;
    teamId?: string;
    baseUrl?: string;
  }) {
    this.token = config.token;
    this.teamId = config.teamId;
    this.baseUrl = config.baseUrl ?? DEFAULT_VERCEL_API_BASE_URL;
  }

  private buildUrl(
    endpoint: string,
    query?: Record<string, string | undefined>,
  ): string {
    const normalizedEndpoint = endpoint.startsWith("/")
      ? endpoint.slice(1)
      : endpoint;
    const normalizedBaseUrl = this.baseUrl.endsWith("/")
      ? this.baseUrl
      : `${this.baseUrl}/`;
    const url = new URL(normalizedEndpoint, normalizedBaseUrl);

    if (this.teamId) {
      url.searchParams.set("teamId", this.teamId);
    }

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, value);
        }
      }
    }

    return url.toString();
  }

  private async request(
    endpoint: string,
    options?: {
      method?: string;
      query?: Record<string, string | undefined>;
      headers?: Record<string, string>;
      body?: RequestInit["body"];
      signal?: AbortSignal;
      allowStatus?: number[];
    },
  ): Promise<Response> {
    const url = this.buildUrl(endpoint, options?.query);
    const method = options?.method ?? "GET";

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "user-agent": USER_AGENT,
        ...options?.headers,
      },
      body: options?.body,
      signal: options?.signal,
    });

    const allowedStatus = options?.allowStatus ?? [];
    if (!response.ok && !allowedStatus.includes(response.status)) {
      throw await VercelApiError.fromResponse(response);
    }

    return response;
  }

  private async requestJson(
    endpoint: string,
    options?: {
      method?: string;
      query?: Record<string, string | undefined>;
      headers?: Record<string, string>;
      body?: unknown;
      signal?: AbortSignal;
    },
  ): Promise<unknown> {
    const hasBody = options && "body" in options;
    const body = hasBody ? JSON.stringify(options.body ?? {}) : undefined;
    const response = await this.request(endpoint, {
      method: options?.method,
      query: options?.query,
      headers: {
        "content-type": "application/json",
        ...options?.headers,
      },
      body,
      signal: options?.signal,
    });

    const text = await response.text();
    if (text.length === 0) {
      return {};
    }
    return JSON.parse(text);
  }

  async startCommand(params: {
    sandboxId: string;
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    sudo?: boolean;
    signal?: AbortSignal;
  }): Promise<VercelCommandData> {
    const json = await this.requestJson(
      `/v1/sandboxes/${params.sandboxId}/cmd`,
      {
        method: "POST",
        body: {
          command: params.command,
          args: params.args ?? [],
          cwd: params.cwd,
          env: params.env ?? {},
          sudo: params.sudo ?? false,
        },
        signal: params.signal,
      },
    );

    return parseCommandEnvelope(json);
  }

  async waitForCommand(params: {
    sandboxId: string;
    commandId: string;
    signal?: AbortSignal;
  }): Promise<VercelCommandData> {
    const json = await this.requestJson(
      `/v1/sandboxes/${params.sandboxId}/cmd/${params.commandId}`,
      {
        query: { wait: "true" },
        signal: params.signal,
      },
    );

    return parseCommandEnvelope(json);
  }

  async killCommand(params: {
    sandboxId: string;
    commandId: string;
    signalNumber?: number;
    signal?: AbortSignal;
  }): Promise<void> {
    await this.requestJson(
      `/v1/sandboxes/${params.sandboxId}/${params.commandId}/kill`,
      {
        method: "POST",
        body: { signal: params.signalNumber ?? 15 },
        signal: params.signal,
      },
    );
  }

  async *streamCommandLogs(params: {
    sandboxId: string;
    commandId: string;
    signal?: AbortSignal;
  }): AsyncGenerator<VercelCommandLogLine, void, void> {
    const response = await this.request(
      `/v1/sandboxes/${params.sandboxId}/cmd/${params.commandId}/logs`,
      {
        signal: params.signal,
      },
    );

    if (response.body === null) {
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";

    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }

      buffered += decoder.decode(chunk.value, { stream: true });

      while (true) {
        const newlineIndex = buffered.indexOf("\n");
        if (newlineIndex < 0) {
          break;
        }

        const line = buffered.slice(0, newlineIndex).trim();
        buffered = buffered.slice(newlineIndex + 1);

        if (line.length === 0) {
          continue;
        }

        yield parseLogLine(JSON.parse(line));
      }
    }

    buffered += decoder.decode();
    const trailing = buffered.trim();
    if (trailing.length > 0) {
      yield parseLogLine(JSON.parse(trailing));
    }
  }

  async collectCommandLogs(params: {
    sandboxId: string;
    commandId: string;
    signal?: AbortSignal;
  }): Promise<{ stdout: string; stderr: string; both: string }> {
    let stdout = "";
    let stderr = "";
    let both = "";

    for await (const log of this.streamCommandLogs(params)) {
      if (log.stream === "error") {
        const errorMessage = `[sandbox-log-error:${log.data.code}] ${log.data.message}`;
        stderr += errorMessage;
        both += errorMessage;
        continue;
      }

      both += log.data;
      if (log.stream === "stdout") {
        stdout += log.data;
      }
      if (log.stream === "stderr") {
        stderr += log.data;
      }
    }

    return { stdout, stderr, both };
  }

  async readFileToBuffer(params: {
    sandboxId: string;
    path: string;
    cwd?: string;
    signal?: AbortSignal;
  }): Promise<Buffer | null> {
    const response = await this.request(
      `/v1/sandboxes/${params.sandboxId}/fs/read`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ path: params.path, cwd: params.cwd }),
        signal: params.signal,
        allowStatus: [404],
      },
    );

    if (response.status === 404) {
      return null;
    }

    const body = await response.arrayBuffer();
    return Buffer.from(body);
  }

  async writeFiles(params: {
    sandboxId: string;
    cwd: string;
    files: { path: string; content: Buffer }[];
    extractDir?: string;
    signal?: AbortSignal;
  }): Promise<void> {
    const extractDir = params.extractDir ?? "/";
    const writer = new FileWriter();
    const tarballPromise = consumeReadable(writer.readable);

    for (const file of params.files) {
      const normalizedPath = normalizePath({
        filePath: file.path,
        cwd: params.cwd,
        extractDir,
      });

      await writer.addFile({
        name: normalizedPath,
        content: file.content,
      });
    }

    const [tarball] = await Promise.all([tarballPromise, writer.end()]);

    await this.request(`/v1/sandboxes/${params.sandboxId}/fs/write`, {
      method: "POST",
      headers: {
        "content-type": "application/gzip",
        "x-cwd": extractDir,
      },
      body: new Uint8Array(tarball),
      signal: params.signal,
    });
  }

  async createDirectory(params: {
    sandboxId: string;
    path: string;
    cwd?: string;
    recursive?: boolean;
    signal?: AbortSignal;
  }): Promise<void> {
    await this.requestJson(`/v1/sandboxes/${params.sandboxId}/fs/mkdir`, {
      method: "POST",
      body: {
        path: params.path,
        cwd: params.cwd,
        recursive: params.recursive,
      },
      signal: params.signal,
    });
  }

  async stopSandbox(params: {
    sandboxId: string;
    signal?: AbortSignal;
  }): Promise<void> {
    await this.requestJson(`/v1/sandboxes/${params.sandboxId}/stop`, {
      method: "POST",
      signal: params.signal,
    });
  }

  async extendTimeout(params: {
    sandboxId: string;
    duration: number;
    signal?: AbortSignal;
  }): Promise<{ expiresAt?: number }> {
    const json = await this.requestJson(
      `/v1/sandboxes/${params.sandboxId}/extend-timeout`,
      {
        method: "POST",
        body: { duration: params.duration },
        signal: params.signal,
      },
    );

    if (!isRecord(json) || !isRecord(json.sandbox)) {
      return { expiresAt: Date.now() + params.duration };
    }

    const requestedStopAt = parseInteger(json.sandbox.requestedStopAt);
    if (requestedStopAt !== null) {
      return { expiresAt: requestedStopAt };
    }

    return { expiresAt: Date.now() + params.duration };
  }

  async createSnapshot(params: {
    sandboxId: string;
    signal?: AbortSignal;
  }): Promise<{ snapshotId: string }> {
    const json = await this.requestJson(
      `/v1/sandboxes/${params.sandboxId}/snapshot`,
      {
        method: "POST",
        signal: params.signal,
      },
    );

    if (!isRecord(json) || !isRecord(json.snapshot)) {
      throw new Error("Invalid snapshot response payload");
    }

    const id = json.snapshot.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("Invalid snapshot response: missing snapshot id");
    }

    return { snapshotId: id };
  }
}
