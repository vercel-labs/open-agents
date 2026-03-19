import type { SandboxInfo } from "./session-chat-context";

type CreateSandboxResponse = SandboxInfo & {
  type: string;
};

type CreateSandboxErrorResponse = {
  error?: string;
  reason?: string;
  actionUrl?: string;
};

export type SandboxCreateErrorDetails = {
  message: string;
  actionUrl?: string;
};

class SandboxCreateRequestError extends Error {
  readonly reason?: string;
  readonly actionUrl?: string;
  readonly status: number;
  readonly responseBody?: string;

  constructor(
    message: string,
    options: {
      status: number;
      reason?: string;
      actionUrl?: string;
      responseBody?: string;
    },
  ) {
    super(message);
    this.name = "SandboxCreateRequestError";
    this.reason = options.reason;
    this.actionUrl = options.actionUrl;
    this.status = options.status;
    this.responseBody = options.responseBody;
  }
}

function parseCreateSandboxErrorResponse(
  rawBody: string,
): CreateSandboxErrorResponse | null {
  if (!rawBody) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return parsed as CreateSandboxErrorResponse;
  } catch {
    return null;
  }
}

function getOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getSandboxCreateErrorDetails(
  error: unknown,
): SandboxCreateErrorDetails {
  if (error instanceof SandboxCreateRequestError) {
    return {
      message: error.message,
      actionUrl: error.actionUrl,
    };
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return { message: error.message };
  }

  return { message: "Failed to create sandbox. Please try again." };
}

function getFallbackSandboxCreateErrorMessage(status: number): string {
  if (status === 403) {
    return "Sandbox access denied. Please reconnect GitHub and try again.";
  }

  return "Failed to create sandbox. Please try again.";
}

export async function createSandbox(
  cloneUrl: string | undefined,
  branch: string | undefined,
  isNewBranch: boolean,
  sessionId: string,
  sandboxType?: string,
): Promise<CreateSandboxResponse> {
  const response = await fetch("/api/sandbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repoUrl: cloneUrl,
      branch: cloneUrl ? (branch ?? "main") : undefined,
      isNewBranch: cloneUrl ? isNewBranch : false,
      sessionId,
      sandboxType: sandboxType ?? "vercel",
    }),
  });

  if (!response.ok) {
    const rawBody = await response.text().catch(() => "");
    const payload = parseCreateSandboxErrorResponse(rawBody);
    const message =
      getOptionalString(payload?.error) ??
      getFallbackSandboxCreateErrorMessage(response.status);

    throw new SandboxCreateRequestError(message, {
      status: response.status,
      reason: getOptionalString(payload?.reason),
      actionUrl: getOptionalString(payload?.actionUrl),
      responseBody: rawBody || undefined,
    });
  }

  const data = (await response.json()) as {
    mode: string;
  } & SandboxInfo;

  return { ...data, type: data.mode };
}
